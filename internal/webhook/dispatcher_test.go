package webhook

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

func TestDispatcherHappyPath(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	conn, _ := store.ConfigureConnection(ctx, "***1234")

	var receivedBody []byte
	var receivedSig, receivedTS, receivedNonce string
	var serverSecret string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedBody, _ = io.ReadAll(r.Body)
		receivedSig = r.Header.Get("X-Bank-Signature")
		receivedTS = r.Header.Get("X-Bank-Timestamp")
		receivedNonce = r.Header.Get("X-Bank-Nonce")
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	ep, err := store.CreateEndpointWithSecret(ctx, "Test Hook", ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	_ = store.SetEndpointStatus(ctx, ep.ID, "ACTIVE")
	serverSecret = ep.Secret

	txn, _ := store.IngestTransaction(ctx, storage.TransactionInput{
		ConnectionID:  conn.ID,
		SemanticKey:   "ACB:100",
		CanonicalHash: "hash100",
		TransactionAt: "2026-09-10",
		EffectiveAt:   "2026-09-10",
		Credit:        50000,
		ParserVersion: "v1",
	})

	_, err = store.EmitTransactionEvent(ctx, txn.TransactionID, "bank.transaction.credit", "acb", "ACB:100", map[string]any{
		"credit": 50000,
	})
	if err != nil {
		t.Fatal(err)
	}

	dispatcher := NewDispatcher(store, ts.Client())
	processed, err := dispatcher.DispatchOne(ctx)
	if err != nil || !processed {
		t.Fatalf("dispatch failed: %v, processed=%v", err, processed)
	}

	// Verify HMAC on received body
	if err := Verify([]byte(serverSecret), receivedBody, receivedTS, receivedNonce, receivedSig, time.Now().UTC(), time.Minute); err != nil {
		t.Fatalf("HMAC verification failed: %v", err)
	}

	// Delivery summary should have 0 pending
	summary, err := store.DeliverySummary(ctx)
	if err != nil || summary.Pending != 0 {
		t.Fatalf("summary unexpected: %+v", summary)
	}
}

func TestDispatcherRetryAndDeadLetter(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	conn, _ := store.ConfigureConnection(ctx, "***1234")

	var attempts atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	ep, err := store.CreateEndpointWithSecret(ctx, "Failing Hook", ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	_ = store.SetEndpointStatus(ctx, ep.ID, "ACTIVE")

	txn, _ := store.IngestTransaction(ctx, storage.TransactionInput{
		ConnectionID:  conn.ID,
		SemanticKey:   "ACB:101",
		CanonicalHash: "hash101",
		TransactionAt: "2026-09-10",
		EffectiveAt:   "2026-09-10",
		Credit:        50000,
		ParserVersion: "v1",
	})

	_, _ = store.EmitTransactionEvent(ctx, txn.TransactionID, "bank.transaction.credit", "acb", "ACB:101", map[string]any{"credit": 50000})

	dispatcher := NewDispatcher(store, ts.Client())
	dispatcher.maxRetries = 2

	// First attempt -> fail, reschedule
	processed, err := dispatcher.DispatchOne(ctx)
	if err != nil || !processed {
		t.Fatalf("first dispatch failed: %v", err)
	}

	// Manually update next_attempt_at to past so it can be claimed again immediately
	_, _ = store.DB().ExecContext(ctx, `UPDATE deliveries SET next_attempt_at = datetime('now', '-1 minute')`)

	// Second attempt -> fail, exceeds maxRetries=2 -> DEAD_LETTER
	processed, err = dispatcher.DispatchOne(ctx)
	if err != nil || !processed {
		t.Fatalf("second dispatch failed: %v", err)
	}

	summary, err := store.DeliverySummary(ctx)
	if err != nil || summary.DeadLetter != 1 || summary.Pending != 0 {
		t.Fatalf("expected 1 dead letter, got: %+v", summary)
	}
}
