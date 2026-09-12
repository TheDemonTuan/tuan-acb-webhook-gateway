package monitor

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/thedemontuan/acb-transaction-webhook/internal/acb"
	"github.com/thedemontuan/acb-transaction-webhook/internal/storage"
	"github.com/thedemontuan/acb-transaction-webhook/internal/telemetry"
)

type BankClient interface {
	Bootstrap(ctx context.Context) (acb.Response, error)
	History(ctx context.Context, endpoint string, fields map[string]string) (acb.Response, error)
}

var ErrSyncUnavailable = errors.New("sync unavailable")

type syncRequest struct {
	connectionID string
	generation   int64
}

type Monitor struct {
	store           *storage.Store
	client          BankClient
	sessions        *SessionLoader
	pollMinInterval time.Duration
	pollMaxInterval time.Duration
	nextInterval    func(time.Duration, time.Duration) time.Duration
	mu              sync.Mutex
	syncMu          sync.Mutex
	syncReq         *syncRequest
	syncCh          chan struct{}
	onNewEvents     func([]storage.EventNotification)
	backoffUntil    time.Time
}

func (m *Monitor) WithEventNotifier(fn func([]storage.EventNotification)) *Monitor {
	m.onNewEvents = fn
	return m
}

func (m *Monitor) UpstreamGate() *sync.Mutex {
	return &m.mu
}

func New(store *storage.Store, client BankClient, minInterval, maxInterval time.Duration) *Monitor {
	if minInterval < 2*time.Second {
		minInterval = 10 * time.Second
	}
	if maxInterval < minInterval {
		maxInterval = minInterval
	}
	return &Monitor{
		store:           store,
		client:          client,
		pollMinInterval: minInterval,
		pollMaxInterval: maxInterval,
		nextInterval: func(minimum, maximum time.Duration) time.Duration {
			if maximum <= minimum {
				return minimum
			}
			return minimum + time.Duration(rand.Int64N(int64(maximum-minimum)+1))
		},
		syncCh: make(chan struct{}, 1),
	}
}

func (m *Monitor) WithSessionLoader(loader *SessionLoader) *Monitor {
	m.sessions = loader
	return m
}

// RequestSync enqueues a bounded manual sync request if the connection is currently in MONITORING state.
func (m *Monitor) RequestSync(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	conn, err := m.store.Connection(ctx)
	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			return ErrSyncUnavailable
		}
		return err
	}
	if conn.State != "MONITORING" {
		return ErrSyncUnavailable
	}

	m.syncMu.Lock()
	defer m.syncMu.Unlock()

	if m.syncReq != nil && m.syncReq.connectionID == conn.ID && m.syncReq.generation == conn.Generation {
		return nil
	}

	m.syncReq = &syncRequest{
		connectionID: conn.ID,
		generation:   conn.Generation,
	}
	if m.syncCh == nil {
		m.syncCh = make(chan struct{}, 1)
	}
	select {
	case m.syncCh <- struct{}{}:
	default:
	}
	return nil
}

// PollOnce executes a single poll cycle if the connection is in MONITORING state.
func (m *Monitor) PollOnce(ctx context.Context) error {
	return m.pollOnce(ctx, nil)
}

func (m *Monitor) pollOnce(ctx context.Context, expected *syncRequest) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return err
	}

	conn, err := m.store.Connection(ctx)
	if err != nil {
		return err
	}
	if conn.State != "MONITORING" {
		return nil // Not in active monitoring state
	}

	if time.Now().Before(m.backoffUntil) {
		slog.Info("skipping poll: circuit breaker backoff active", "until", m.backoffUntil)
		return nil
	}

	hasActiveAttempt, err := m.store.HasActiveAuthAttempt(ctx, conn.ID)
	if err == nil && hasActiveAttempt {
		slog.Info("skipping poll: browser authentication in progress", "connection_id", conn.ID)
		return nil
	}

	if expected != nil {
		if conn.ID != expected.connectionID || conn.Generation != expected.generation {
			return nil // Stale sync skipped
		}
	}
	if m.client == nil {
		return errors.New("bank client not configured")
	}
	if m.sessions != nil {
		if err := m.sessions.Restore(ctx, conn.ID, conn.Generation); err != nil {
			return fmt.Errorf("restore ACB session: %w", err)
		}
	}

	poll, err := m.store.StartPoll(ctx)
	if err != nil {
		return fmt.Errorf("start poll: %w", err)
	}

	// 1. Fetch account detail page to verify session and extract form state
	resp, err := m.client.Bootstrap(ctx)
	if err != nil {
		poll.Status = "FAILED"
		poll.Error = err.Error()
		_ = m.store.FinishPoll(ctx, poll)
		return err
	}

	poll.Classifier = string(resp.Kind)
	poll.HTTPStatus = resp.StatusCode

	if resp.Kind == acb.LoginPage {
		poll.Status = "AUTH_REQUIRED"
		poll.Error = "SESSION_EXPIRED"
		_ = m.store.FinishPoll(ctx, poll)
		slog.Warn("ACB confirmed the session is no longer authenticated; transitioned to AUTH_REQUIRED")
		return nil
	}
	if resp.Kind == acb.OTPChallenge || resp.Kind == acb.CaptchaPage {
		poll.Status = "AUTH_REQUIRED"
		poll.Error = string(resp.Kind)
		_ = m.store.FinishPoll(ctx, poll)
		slog.Warn("ACB requires interactive authentication", "challenge", resp.Kind)
		return nil
	}

	if resp.StatusCode == 429 {
		poll.Status = "FAILED"
		poll.Error = "ACB_RATE_LIMITED"
		m.backoffUntil = time.Now().Add(60 * time.Second)
		telemetry.Default.SetCircuitBreaker(true)
		_ = m.store.FinishPoll(ctx, poll)
		slog.Warn("ACB rate limit detected (429); backoff for 60s")
		return nil
	}

	if resp.Kind == acb.MaintenancePage {
		poll.Status = "FAILED"
		poll.Error = "ACB_MAINTENANCE"
		m.backoffUntil = time.Now().Add(60 * time.Second)
		telemetry.Default.SetCircuitBreaker(true)
		_ = m.store.FinishPoll(ctx, poll)
		slog.Warn("ACB maintenance detected; backoff for 60s")
		return nil
	}

	// If the page is not HistoryPage directly, try extracting form state
	historyMarkup := resp.Body
	if resp.Kind != acb.HistoryPage {
		form, formErr := acb.ExtractHistoryForm(resp.Body)
		if formErr != nil {
			poll.Status = "FAILED"
			poll.Error = formErr.Error()
			_ = m.store.FinishPoll(ctx, poll)
			return formErr
		}

		nowVN := time.Now().UTC().Add(7 * time.Hour)
		if form.Fields["ToDate"] == "" {
			form.Fields["ToDate"] = nowVN.Format("02/01/2006")
		}
		if form.Fields["FromDate"] == "" {
			form.Fields["FromDate"] = nowVN.AddDate(0, 0, -30).Format("02/01/2006")
		}
		if form.Fields["AccountNbr"] == "" && conn.AccountMasked != "" {
			form.Fields["AccountNbr"] = conn.AccountMasked
		}
		form.Fields["dse_nextEventName"] = "byDate"
		if form.Fields["activeDatetimeYN"] == "" {
			form.Fields["activeDatetimeYN"] = "N"
		}
		if form.Fields["CheckRef"] == "" {
			form.Fields["CheckRef"] = "false"
		}
		if form.Fields["CheckDoiUng"] == "" {
			form.Fields["CheckDoiUng"] = "false"
		}

		histResp, histErr := m.client.History(ctx, form.Action, form.Fields)
		if histErr != nil {
			poll.Status = "FAILED"
			poll.Error = histErr.Error()
			_ = m.store.FinishPoll(ctx, poll)
			return histErr
		}
		historyMarkup = histResp.Body
		poll.Classifier = string(histResp.Kind)
		poll.HTTPStatus = histResp.StatusCode

		if histResp.Kind == acb.LoginPage {
			poll.Status = "AUTH_REQUIRED"
			poll.Error = "SESSION_EXPIRED"
			_ = m.store.FinishPoll(ctx, poll)
			return nil
		}
		if histResp.Kind == acb.OTPChallenge || histResp.Kind == acb.CaptchaPage {
			poll.Status = "AUTH_REQUIRED"
			poll.Error = string(histResp.Kind)
			_ = m.store.FinishPoll(ctx, poll)
			return nil
		}
	}

	// Parse transaction history
	txns, parseErr := acb.ParseHistory(historyMarkup)
	if parseErr != nil {
		poll.Status = "FAILED"
		poll.Error = parseErr.Error()
		_ = m.store.FinishPoll(ctx, poll)
		return parseErr
	}

	poll.RowsSeen = len(txns)
	poll.Pages = 1

	// Ingest transactions and emit credit events atomically in a single batch transaction
	batchItems := make([]storage.BatchTransactionItem, len(txns))
	for i, txn := range txns {
		batchItems[i] = storage.BatchTransactionItem{
			Number:        txn.Number,
			Credit:        txn.Credit,
			Debit:         txn.Debit,
			Balance:       txn.Balance,
			TransactionAt: txn.TransactionAt,
			EffectiveAt:   txn.EffectiveDate,
			Description:   txn.Description,
		}
	}

	startIngest := time.Now()
	batchRes, err := m.store.IngestTransactionsBatch(ctx, conn.ID, conn.Generation, conn.AccountMasked, batchItems, false)
	telemetry.Default.RecordIngest(time.Since(startIngest))
	telemetry.Default.SetLastACBPollAt(time.Now())
	if err != nil {
		if errors.Is(err, storage.ErrGenerationFenceMismatch) {
			slog.Warn("ingest rejected by generation fence", "error", err)
			poll.Status = "FAILED"
			poll.Error = err.Error()
			_ = m.store.FinishPoll(ctx, poll)
			return err
		}
		slog.Error("batch ingest failed", "error", err)
		poll.Status = "FAILED"
		poll.Error = err.Error()
		_ = m.store.FinishPoll(ctx, poll)
		return err
	}

	poll.Status = "SUCCEEDED"
	m.backoffUntil = time.Time{}
	telemetry.Default.SetCircuitBreaker(false)
	if err := m.store.FinishPoll(ctx, poll); err != nil {
		return err
	}

	if len(batchRes.NewEvents) > 0 && m.onNewEvents != nil {
		m.onNewEvents(batchRes.NewEvents)
	}
	if m.sessions != nil {
		if err := m.sessions.Persist(ctx, conn.ID, conn.Generation); err != nil {
			slog.Warn("could not persist refreshed ACB session", "error", err)
		}
	}
	return nil
}

func (m *Monitor) Run(ctx context.Context) {
	m.syncMu.Lock()
	if m.syncCh == nil {
		m.syncCh = make(chan struct{}, 1)
	}
	syncCh := m.syncCh
	m.syncMu.Unlock()

	timer := time.NewTimer(m.nextInterval(m.pollMinInterval, m.pollMaxInterval))
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-syncCh:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			m.syncMu.Lock()
			req := m.syncReq
			m.syncReq = nil
			m.syncMu.Unlock()
			if req != nil {
				if err := m.pollOnce(ctx, req); err != nil {
					slog.Warn("monitor sync poll completed with error", "error", err)
				}
			}
		case <-timer.C:
			if err := m.pollOnce(ctx, nil); err != nil {
				slog.Warn("monitor poll cycle completed with error", "error", err)
			}
		}
		timer.Reset(m.nextInterval(m.pollMinInterval, m.pollMaxInterval))
	}
}
