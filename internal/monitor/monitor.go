package monitor

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/thedemontuan/tuan-bank-gateway/internal/acb"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

type BankClient interface {
	Get(ctx context.Context, endpoint string) (acb.Response, error)
	History(ctx context.Context, endpoint string, fields map[string]string) (acb.Response, error)
}

var ErrSyncUnavailable = errors.New("sync unavailable")

type syncRequest struct {
	connectionID string
	generation   int64
}

type Monitor struct {
	store        *storage.Store
	client       BankClient
	sessions     *SessionLoader
	pollInterval time.Duration
	mu           sync.Mutex
	syncMu       sync.Mutex
	syncReq      *syncRequest
	syncCh       chan struct{}
}

func New(store *storage.Store, client BankClient, interval time.Duration) *Monitor {
	if interval < 2*time.Second {
		interval = 15 * time.Second
	}
	return &Monitor{
		store:        store,
		client:       client,
		pollInterval: interval,
		syncCh:       make(chan struct{}, 1),
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
	resp, err := m.client.Get(ctx, "/acbib/Request")
	if err != nil {
		poll.Status = "FAILED"
		poll.Error = err.Error()
		_ = m.store.FinishPoll(ctx, poll)
		return err
	}

	poll.Classifier = string(resp.Kind)
	poll.HTTPStatus = resp.StatusCode

	if resp.Kind == acb.LoginPage || resp.Kind == acb.OTPChallenge {
		poll.Status = "AUTH_REQUIRED"
		poll.Error = "SESSION_EXPIRED"
		_ = m.store.FinishPoll(ctx, poll)
		slog.Warn("ACB session expired, transitioned to AUTH_REQUIRED")
		return nil
	}

	if resp.Kind == acb.MaintenancePage {
		poll.Status = "FAILED"
		poll.Error = "ACB_MAINTENANCE"
		_ = m.store.FinishPoll(ctx, poll)
		return nil
	}

	// If the page is not HistoryPage directly, try extracting form state
	historyMarkup := resp.Body
	if resp.Kind != acb.HistoryPage {
		form, formErr := acb.ExtractHistoryForm(resp.Body)
		if formErr != nil {
			poll.Status = "PROTOCOL_CHANGED"
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
		if form.Fields["dse_nextEventName"] == "" {
			form.Fields["dse_nextEventName"] = "byDate"
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
	}

	// Parse transaction history
	txns, parseErr := acb.ParseHistory(historyMarkup)
	if parseErr != nil {
		poll.Status = "PROTOCOL_CHANGED"
		poll.Error = parseErr.Error()
		_ = m.store.FinishPoll(ctx, poll)
		return parseErr
	}

	poll.RowsSeen = len(txns)
	poll.Pages = 1

	// Ingest transactions and emit credit events
	for _, txn := range txns {
		semanticKey := fmt.Sprintf("ACB:%s", txn.Number)
		canonicalHash := fmt.Sprintf("%s:%d:%d:%s", txn.Number, txn.Credit, txn.Debit, txn.TransactionAt)

		ingestRes, err := m.store.IngestTransaction(ctx, storage.TransactionInput{
			ConnectionID:  conn.ID,
			SemanticKey:   semanticKey,
			CanonicalHash: canonicalHash,
			TransactionAt: txn.TransactionAt,
			EffectiveAt:   txn.EffectiveDate,
			Debit:         txn.Debit,
			Credit:        txn.Credit,
			Balance:       txn.Balance,
			Description:   []byte(txn.Description),
			ParserVersion: "v1",
		})
		if err != nil {
			slog.Error("failed to ingest transaction", "error", err, "key", semanticKey)
			continue
		}

		// Emit event for new credit transactions
		if ingestRes.Inserted && txn.Credit > 0 {
			eventData := map[string]any{
				"bank":              "ACB",
				"accountMasked":     conn.AccountMasked,
				"transactionNumber": txn.Number,
				"credit":            fmt.Sprintf("%d", txn.Credit),
				"debit":             fmt.Sprintf("%d", txn.Debit),
				"currency":          "VND",
				"transactionDate":   txn.TransactionAt,
				"description":       txn.Description,
				"detectedAt":        time.Now().UTC().Format(time.RFC3339),
			}
			if txn.Balance != nil {
				eventData["balance"] = fmt.Sprintf("%d", *txn.Balance)
			}

			_, _ = m.store.EmitTransactionEvent(ctx, ingestRes.TransactionID, "bank.transaction.credit", "acb", semanticKey, eventData)
		}
	}

	poll.Status = "SUCCEEDED"
	return m.store.FinishPoll(ctx, poll)
}

func (m *Monitor) Run(ctx context.Context) {
	ticker := time.NewTicker(m.pollInterval)
	defer ticker.Stop()

	m.syncMu.Lock()
	if m.syncCh == nil {
		m.syncCh = make(chan struct{}, 1)
	}
	syncCh := m.syncCh
	m.syncMu.Unlock()

	for {
		select {
		case <-ctx.Done():
			return
		case <-syncCh:
			if ctx.Err() != nil {
				return
			}
			m.syncMu.Lock()
			req := m.syncReq
			m.syncReq = nil
			m.syncMu.Unlock()

			if req != nil {
				if err := m.pollOnce(ctx, req); err != nil {
					slog.Warn("monitor sync poll completed with error", "error", err)
				}
				ticker.Reset(m.pollInterval)
			}
		case <-ticker.C:
			if ctx.Err() != nil {
				return
			}
			if err := m.PollOnce(ctx); err != nil {
				slog.Warn("monitor poll cycle completed with error", "error", err)
			}
		}
	}
}
