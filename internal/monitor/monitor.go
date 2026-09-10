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

type Monitor struct {
	store        *storage.Store
	client       BankClient
	sessions     *SessionLoader
	pollInterval time.Duration
	mu           sync.Mutex
}

func New(store *storage.Store, client BankClient, interval time.Duration) *Monitor {
	if interval < 2*time.Second {
		interval = 15 * time.Second
	}
	return &Monitor{
		store:        store,
		client:       client,
		pollInterval: interval,
	}
}

func (m *Monitor) WithSessionLoader(loader *SessionLoader) *Monitor {
	m.sessions = loader
	return m
}

// PollOnce executes a single poll cycle if the connection is in MONITORING state.
func (m *Monitor) PollOnce(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	conn, err := m.store.Connection(ctx)
	if err != nil {
		return err
	}
	if conn.State != "MONITORING" {
		return nil // Not in active monitoring state
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

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := m.PollOnce(ctx); err != nil {
				slog.Warn("monitor poll cycle completed with error", "error", err)
			}
		}
	}
}
