package notification

import (
	"context"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/thedemontuan/acb-transaction-webhook/internal/security"
	"github.com/thedemontuan/acb-transaction-webhook/internal/storage"
)

type mockSender struct {
	outcome           Outcome
	statusCode        int
	providerErrorCode string
	sanitizedError    string
	calls             int
}

func (m *mockSender) Send(ctx context.Context, req SendRequest) SendResult {
	m.calls++
	return SendResult{
		Outcome:           m.outcome,
		StatusCode:        m.statusCode,
		LatencyMs:         10,
		ProviderErrorCode: m.providerErrorCode,
		SanitizedError:    m.sanitizedError,
	}
}

func setupTestStoreWithKeyring(t *testing.T) *storage.Store {
	t.Helper()
	ctx := context.Background()
	keyPath := filepath.Join(t.TempDir(), "master.key")
	rawKey := make([]byte, 32)
	for i := range rawKey {
		rawKey[i] = byte(i + 1)
	}
	if err := os.WriteFile(keyPath, []byte(hex.EncodeToString(rawKey)), 0o600); err != nil {
		t.Fatal(err)
	}
	kr, err := security.LoadKeyring(keyPath)
	if err != nil {
		t.Fatal(err)
	}

	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	store.WithKeyring(kr)
	return store
}

func TestDispatcherMixedProviders(t *testing.T) {
	ctx := context.Background()
	store := setupTestStoreWithKeyring(t)
	defer store.Close()

	conn, _ := store.ConfigureConnection(ctx, "***1234")
	_, _ = store.DB().ExecContext(ctx, `UPDATE connections SET state = 'MONITORING' WHERE id = ?`, conn.ID)

	wh, _ := store.CreateEndpointWithSecret(ctx, "Test Hook", "https://example.com/webhook")
	_ = store.SetEndpointStatus(ctx, wh.ID, "ACTIVE")

	barkCh, _ := store.CreateBarkChannel(ctx, "Test iPhone", "device_key_123", nil)
	_ = store.SetEndpointStatus(ctx, barkCh.ID, "ACTIVE")

	_, _ = store.IngestTransactionsBatch(ctx, conn.ID, conn.Generation, "***1234", []storage.BatchTransactionItem{
		{
			Number:        "MIX_001",
			TransactionAt: "2026-09-13T12:00:00Z",
			Credit:        100000,
			Description:   "Test mixed dispatch",
		},
	}, false)

	registry := NewRegistry()
	whSender := &mockSender{outcome: OutcomeSuccess, statusCode: 200}
	barkSender := &mockSender{outcome: OutcomeSuccess, statusCode: 200}
	registry.Register("WEBHOOK", whSender)
	registry.Register("BARK", barkSender)

	dispatcher := NewDispatcher(store, registry)

	// Dispatch 1
	p1, err := dispatcher.DispatchOne(ctx)
	if err != nil || !p1 {
		t.Fatalf("first dispatch failed: %v", err)
	}

	// Dispatch 2
	p2, err := dispatcher.DispatchOne(ctx)
	if err != nil || !p2 {
		t.Fatalf("second dispatch failed: %v", err)
	}

	// Dispatch 3 -> nothing left
	p3, err := dispatcher.DispatchOne(ctx)
	if err != nil || p3 {
		t.Fatalf("expected queue empty, got: %v", p3)
	}

	if whSender.calls != 1 || barkSender.calls != 1 {
		t.Fatalf("expected 1 call each, got wh=%d bark=%d", whSender.calls, barkSender.calls)
	}

	summary, _ := store.DeliverySummary(ctx)
	if summary.Pending != 0 || summary.DeadLetter != 0 {
		t.Fatalf("expected 0 pending and 0 deadletter, got: %+v", summary)
	}
}

func TestDispatcherRetryExhaustionAndReplay(t *testing.T) {
	ctx := context.Background()
	store := setupTestStoreWithKeyring(t)
	defer store.Close()

	conn, _ := store.ConfigureConnection(ctx, "***1234")
	_, _ = store.DB().ExecContext(ctx, `UPDATE connections SET state = 'MONITORING' WHERE id = ?`, conn.ID)

	barkCh, _ := store.CreateBarkChannel(ctx, "Failing iPhone", "key_fail", nil)
	_ = store.SetEndpointStatus(ctx, barkCh.ID, "ACTIVE")

	_, _ = store.IngestTransactionsBatch(ctx, conn.ID, conn.Generation, "***1234", []storage.BatchTransactionItem{
		{
			Number:        "FAIL_001",
			TransactionAt: "2026-09-13T12:00:00Z",
			Credit:        200000,
			Description:   "Test fail dispatch",
		},
	}, false)

	registry := NewRegistry()
	failingSender := &mockSender{outcome: OutcomeRetry, statusCode: 502, providerErrorCode: "HTTP_502"}
	registry.Register("BARK", failingSender)

	dispatcher := NewDispatcher(store, registry)
	dispatcher.SetMaxRetries(2)

	// Attempt 1 -> OutcomeRetry
	p1, err := dispatcher.DispatchOne(ctx)
	if err != nil || !p1 {
		t.Fatal(err)
	}

	// Make past due
	_, _ = store.DB().ExecContext(ctx, `UPDATE deliveries SET next_attempt_at = datetime('now', '-1 minute')`)

	// Attempt 2 -> OutcomeRetry, but attempts (2) >= maxRetries (2) -> DEAD_LETTER
	p2, err := dispatcher.DispatchOne(ctx)
	if err != nil || !p2 {
		t.Fatal(err)
	}

	summary, _ := store.DeliverySummary(ctx)
	if summary.DeadLetter != 1 {
		t.Fatalf("expected 1 deadletter, got: %+v", summary)
	}

	var deliveryID string
	_ = store.DB().QueryRowContext(ctx, `SELECT id FROM deliveries WHERE status = 'DEAD_LETTER'`).Scan(&deliveryID)

	// Replay delivery
	err = store.ReplayDelivery(ctx, deliveryID)
	if err != nil {
		t.Fatalf("ReplayDelivery failed: %v", err)
	}

	// Sender now succeeds
	failingSender.outcome = OutcomeSuccess
	failingSender.statusCode = 200

	p3, err := dispatcher.DispatchOne(ctx)
	if err != nil || !p3 {
		t.Fatalf("dispatch after replay failed: %v", err)
	}

	summary, _ = store.DeliverySummary(ctx)
	if summary.Pending != 0 || summary.DeadLetter != 0 {
		t.Fatalf("expected completed delivery, got: %+v", summary)
	}
}
