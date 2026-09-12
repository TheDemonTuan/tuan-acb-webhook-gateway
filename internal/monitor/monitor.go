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
	settingsCh      chan struct{}
	cachedSettings  storage.MonitorSettings
	lastMode        storage.PollMode
	historyGroup    Group
	onNewEvents     func([]storage.EventNotification)
	onPollFinished  func(poll storage.PollRun, insertedCount int)
	backoffUntil    time.Time
}

func (m *Monitor) WithEventNotifier(fn func([]storage.EventNotification)) *Monitor {
	m.onNewEvents = fn
	return m
}

func (m *Monitor) WithPollNotifier(fn func(poll storage.PollRun, insertedCount int)) *Monitor {
	m.onPollFinished = fn
	return m
}

func (m *Monitor) finishPoll(ctx context.Context, poll storage.PollRun, insertedCount int) error {
	err := m.store.FinishPoll(ctx, poll)
	if m.onPollFinished != nil {
		m.onPollFinished(poll, insertedCount)
	}
	return err
}

func (m *Monitor) UpstreamGate() *sync.Mutex {
	return &m.mu
}

func New(store *storage.Store, client BankClient, minInterval, maxInterval time.Duration) *Monitor {
	if minInterval < 2*time.Second {
		minInterval = 5 * time.Second
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
		syncCh:         make(chan struct{}, 1),
		settingsCh:     make(chan struct{}, 1),
		cachedSettings: storage.DefaultMonitorSettings,
	}
}

func (m *Monitor) NotifySettingsChanged() {
	select {
	case m.settingsCh <- struct{}{}:
	default:
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

// EnsureHistory ensures ACB transaction history for the requested [fromDay, toDay] date range is synchronized.
// It coalesces concurrent requests, checks cached coverage with TTLs, pushes date filters to ACB, and ingests with FILTER_SYNC source.
func (m *Monitor) EnsureHistory(ctx context.Context, fromDay, toDay string) (int, error) {
	fromT, err := time.Parse("2006-01-02", fromDay)
	if err != nil {
		return 0, fmt.Errorf("invalid from date: %w", err)
	}
	toT, err := time.Parse("2006-01-02", toDay)
	if err != nil {
		return 0, fmt.Errorf("invalid to date: %w", err)
	}
	if fromT.After(toT) {
		return 0, errors.New("from date must not be after to date")
	}
	if toT.Sub(fromT) > 31*24*time.Hour {
		return 0, errors.New("range too large (max 31 days)")
	}

	conn, err := m.store.Connection(ctx)
	if err != nil {
		return 0, err
	}
	if conn.State != "MONITORING" {
		return 0, errors.New("bank connection is not in MONITORING state")
	}

	// 1. Fast cache check
	covered, err := m.store.CheckRangeCoverage(ctx, conn.ID, fromDay, toDay)
	if err == nil && covered {
		return 0, nil
	}

	// 2. Coalescing single-flight group
	flightKey := fmt.Sprintf("%s:%s:%s", conn.ID, fromDay, toDay)
	val, err := m.historyGroup.Do(flightKey, func() (any, error) {
		// Re-check coverage under flight
		if cov, _ := m.store.CheckRangeCoverage(ctx, conn.ID, fromDay, toDay); cov {
			return 0, nil
		}

		m.mu.Lock()
		defer m.mu.Unlock()

		if time.Now().Before(m.backoffUntil) {
			return 0, errors.New("circuit breaker backoff active")
		}

		if m.client == nil {
			return 0, errors.New("bank client not configured")
		}
		if m.sessions != nil {
			if err := m.sessions.Restore(ctx, conn.ID, conn.Generation); err != nil {
				return 0, fmt.Errorf("restore ACB session: %w", err)
			}
		}

		resp, err := m.client.Bootstrap(ctx)
		if err != nil {
			return 0, fmt.Errorf("bootstrap ACB session: %w", err)
		}
		if resp.Kind == acb.LoginPage || resp.Kind == acb.OTPChallenge || resp.Kind == acb.CaptchaPage {
			return 0, errors.New("ACB session expired or challenge required")
		}
		if resp.Kind == acb.MaintenancePage {
			m.backoffUntil = time.Now().Add(60 * time.Second)
			return 0, errors.New("ACB maintenance")
		}

		form, formErr := acb.ExtractHistoryForm(resp.Body)
		if formErr != nil {
			return 0, fmt.Errorf("extract history form: %w", formErr)
		}

		if form.Fields["AccountNbr"] == "" && conn.AccountMasked != "" {
			form.Fields["AccountNbr"] = conn.AccountMasked
		}

		fromACB := fromT.Format("02/01/2006")
		toACB := toT.Format("02/01/2006")
		form.Fields["FromDate"] = fromACB
		form.Fields["ToDate"] = toACB
		form.Fields["_explicitRange"] = "true"

		histResp, histErr := m.client.History(ctx, form.Action, form.Fields)
		if histErr != nil {
			return 0, fmt.Errorf("query ACB history range: %w", histErr)
		}
		if histResp.Kind == acb.LoginPage || histResp.Kind == acb.OTPChallenge {
			return 0, errors.New("ACB session expired during history query")
		}

		txns, parseErr := acb.ParseHistory(histResp.Body)
		if parseErr != nil {
			return 0, fmt.Errorf("parse ACB history: %w", parseErr)
		}

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

		// Ingest with FILTER_SYNC source (suppressing webhooks and voice)
		_, ingestErr := m.store.IngestTransactionsBatchWithSource(ctx, conn.ID, conn.Generation, conn.AccountMasked, batchItems, false, "FILTER_SYNC")
		if ingestErr != nil {
			return 0, fmt.Errorf("ingest history transactions: %w", ingestErr)
		}

		var days []string
		for cur := fromT; !cur.After(toT); cur = cur.AddDate(0, 0, 1) {
			days = append(days, cur.Format("2006-01-02"))
		}
		_ = m.store.RecordCoverage(ctx, conn.ID, days, len(txns))

		return len(txns), nil
	})

	if err != nil {
		return 0, err
	}
	return val.(int), nil
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
		_ = m.finishPoll(ctx, poll, 0)
		return err
	}

	poll.Classifier = string(resp.Kind)
	poll.HTTPStatus = resp.StatusCode

	if resp.Kind == acb.LoginPage {
		poll.Status = "AUTH_REQUIRED"
		poll.Error = "SESSION_EXPIRED"
		_ = m.finishPoll(ctx, poll, 0)
		slog.Warn("ACB confirmed the session is no longer authenticated; transitioned to AUTH_REQUIRED")
		return nil
	}
	if resp.Kind == acb.OTPChallenge || resp.Kind == acb.CaptchaPage {
		poll.Status = "AUTH_REQUIRED"
		poll.Error = string(resp.Kind)
		_ = m.finishPoll(ctx, poll, 0)
		slog.Warn("ACB requires interactive authentication", "challenge", resp.Kind)
		return nil
	}

	if resp.StatusCode == 429 {
		poll.Status = "FAILED"
		poll.Error = "ACB_RATE_LIMITED"
		m.backoffUntil = time.Now().Add(60 * time.Second)
		telemetry.Default.SetCircuitBreaker(true)
		_ = m.finishPoll(ctx, poll, 0)
		slog.Warn("ACB rate limit detected (429); backoff for 60s")
		return nil
	}

	if resp.Kind == acb.MaintenancePage {
		poll.Status = "FAILED"
		poll.Error = "ACB_MAINTENANCE"
		m.backoffUntil = time.Now().Add(60 * time.Second)
		telemetry.Default.SetCircuitBreaker(true)
		_ = m.finishPoll(ctx, poll, 0)
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
			_ = m.finishPoll(ctx, poll, 0)
			return formErr
		}

		if form.Fields["AccountNbr"] == "" && conn.AccountMasked != "" {
			form.Fields["AccountNbr"] = conn.AccountMasked
		}
		histResp, histErr := m.client.History(ctx, form.Action, form.Fields)
		if histErr != nil {
			poll.Status = "FAILED"
			poll.Error = histErr.Error()
			_ = m.finishPoll(ctx, poll, 0)
			return histErr
		}
		historyMarkup = histResp.Body
		poll.Classifier = string(histResp.Kind)
		poll.HTTPStatus = histResp.StatusCode

		if histResp.Kind == acb.LoginPage {
			poll.Status = "AUTH_REQUIRED"
			poll.Error = "SESSION_EXPIRED"
			_ = m.finishPoll(ctx, poll, 0)
			return nil
		}
		if histResp.Kind == acb.OTPChallenge || histResp.Kind == acb.CaptchaPage {
			poll.Status = "AUTH_REQUIRED"
			poll.Error = string(histResp.Kind)
			_ = m.finishPoll(ctx, poll, 0)
			return nil
		}
	}

	// Parse transaction history
	txns, parseErr := acb.ParseHistory(historyMarkup)
	if parseErr != nil {
		poll.Status = "FAILED"
		poll.Error = parseErr.Error()
		_ = m.finishPoll(ctx, poll, 0)
		return parseErr
	}

	poll.RowsSeen = len(txns)
	poll.Pages = 1
	slog.Info("ACB history parsed", "rows_seen", poll.RowsSeen, "pages", poll.Pages)

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
			_ = m.finishPoll(ctx, poll, 0)
			return err
		}
		slog.Error("batch ingest failed", "error", err)
		poll.Status = "FAILED"
		poll.Error = err.Error()
		_ = m.finishPoll(ctx, poll, 0)
		return err
	}

	poll.Status = "SUCCEEDED"
	m.backoffUntil = time.Time{}
	telemetry.Default.SetCircuitBreaker(false)
	if err := m.finishPoll(ctx, poll, batchRes.InsertedCount); err != nil {
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

func (m *Monitor) pollKeepalive(ctx context.Context) error {
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
		return nil
	}

	if time.Now().Before(m.backoffUntil) {
		return nil
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

	// Bootstrap page only to keep session alive and rotate cookies - never calls History!
	resp, err := m.client.Bootstrap(ctx)
	if err != nil {
		poll.Status = "FAILED"
		poll.Error = err.Error()
		_ = m.finishPoll(ctx, poll, 0)
		return err
	}

	poll.Classifier = string(resp.Kind)
	poll.HTTPStatus = resp.StatusCode

	if resp.Kind == acb.LoginPage || resp.Kind == acb.OTPChallenge || resp.Kind == acb.CaptchaPage {
		poll.Status = "AUTH_REQUIRED"
		poll.Error = "SESSION_EXPIRED"
		_ = m.finishPoll(ctx, poll, 0)
		slog.Warn("ACB session expired during keepalive; transitioned to AUTH_REQUIRED")
		return nil
	}

	if resp.StatusCode == 429 {
		poll.Status = "FAILED"
		poll.Error = "ACB_RATE_LIMITED"
		m.backoffUntil = time.Now().Add(60 * time.Second)
		_ = m.finishPoll(ctx, poll, 0)
		return nil
	}

	if resp.Kind == acb.MaintenancePage {
		poll.Status = "FAILED"
		poll.Error = "ACB_MAINTENANCE"
		m.backoffUntil = time.Now().Add(60 * time.Second)
		_ = m.finishPoll(ctx, poll, 0)
		return nil
	}

	if m.sessions != nil {
		_ = m.sessions.Persist(ctx, conn.ID, conn.Generation)
	}

	poll.Status = "SUCCEEDED"
	poll.Pages = 0
	poll.RowsSeen = 0
	return m.finishPoll(ctx, poll, 0)
}

func (m *Monitor) catchUp(ctx context.Context) error {
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
		return nil
	}

	nowInLoc := time.Now().In(acb.DefaultLocation)
	yesterday := nowInLoc.AddDate(0, 0, -1).Format("2006-01-02")
	today := nowInLoc.Format("2006-01-02")

	slog.Info("running catch-up history sync before resuming realtime", "from", yesterday, "to", today)

	if m.client == nil {
		return errors.New("bank client not configured")
	}
	if m.sessions != nil {
		if err := m.sessions.Restore(ctx, conn.ID, conn.Generation); err != nil {
			return fmt.Errorf("restore ACB session: %w", err)
		}
	}

	resp, err := m.client.Bootstrap(ctx)
	if err != nil {
		return fmt.Errorf("bootstrap for catch-up: %w", err)
	}
	if resp.Kind == acb.LoginPage || resp.Kind == acb.OTPChallenge || resp.Kind == acb.CaptchaPage {
		return errors.New("session expired")
	}

	form, formErr := acb.ExtractHistoryForm(resp.Body)
	if formErr != nil {
		return fmt.Errorf("extract history form: %w", formErr)
	}
	if form.Fields["AccountNbr"] == "" && conn.AccountMasked != "" {
		form.Fields["AccountNbr"] = conn.AccountMasked
	}

	fromT, _ := time.Parse("2006-01-02", yesterday)
	toT, _ := time.Parse("2006-01-02", today)
	form.Fields["FromDate"] = fromT.Format("02/01/2006")
	form.Fields["ToDate"] = toT.Format("02/01/2006")
	form.Fields["_explicitRange"] = "true"

	histResp, histErr := m.client.History(ctx, form.Action, form.Fields)
	if histErr != nil {
		return fmt.Errorf("catch-up history query: %w", histErr)
	}
	txns, parseErr := acb.ParseHistory(histResp.Body)
	if parseErr != nil {
		return fmt.Errorf("catch-up parse: %w", parseErr)
	}

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

	// Ingest with CATCH_UP source:
	// New credit transactions enqueue webhooks (no missed payments!), but voice is suppressed!
	res, err := m.store.IngestTransactionsBatchWithSource(ctx, conn.ID, conn.Generation, conn.AccountMasked, batchItems, false, "CATCH_UP")
	if err != nil {
		return fmt.Errorf("catch-up ingest: %w", err)
	}

	slog.Info("catch-up completed", "inserted", res.InsertedCount, "skipped", res.SkippedCount)
	return nil
}

func (m *Monitor) Run(ctx context.Context) {
	m.syncMu.Lock()
	if m.syncCh == nil {
		m.syncCh = make(chan struct{}, 1)
	}
	syncCh := m.syncCh
	m.syncMu.Unlock()

	// Initial load of settings from database
	if initSettings, err := m.store.GetMonitorSettings(ctx); err == nil {
		m.cachedSettings = initSettings
	}

	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()

	for {
		schedule := storage.ResolveSchedule(time.Now(), &m.cachedSettings)

		// Transition check: transitioning into REALTIME triggers catch-up!
		if (m.lastMode == storage.ModeKeepaliveOnly || m.lastMode == storage.ModePaused) && schedule.Mode == storage.ModeRealtime {
			if err := m.catchUp(ctx); err != nil {
				slog.Warn("catch-up sync failed", "error", err)
			}
		}
		m.lastMode = schedule.Mode

		wait := m.nextInterval(schedule.MinInterval, schedule.MaxInterval)
		if schedule.Mode == storage.ModePaused {
			wait = 10 * time.Minute
		}
		untilTrans := time.Until(schedule.NextTransition)
		if untilTrans > 0 && untilTrans < wait {
			wait = untilTrans
		}
		timer.Reset(wait)

		select {
		case <-ctx.Done():
			return

		case <-m.settingsCh:
			// Hot reload settings
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			if s, err := m.store.GetMonitorSettings(ctx); err == nil {
				m.cachedSettings = s
				slog.Info("monitor schedule hot-reloaded", "revision", s.Revision, "enabled", s.Enabled)
			}
			continue

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
			switch schedule.Mode {
			case storage.ModeRealtime:
				if err := m.pollOnce(ctx, nil); err != nil {
					slog.Warn("monitor poll cycle completed with error", "error", err)
				}
			case storage.ModeKeepaliveOnly:
				if err := m.pollKeepalive(ctx); err != nil {
					slog.Warn("monitor keepalive cycle completed with error", "error", err)
				}
			case storage.ModePaused:
				// No upstream request
			}
		}
	}
}
