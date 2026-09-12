package httpapi

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/thedemontuan/acb-transaction-webhook/internal/config"
	"github.com/thedemontuan/acb-transaction-webhook/internal/eventhub"
	"github.com/thedemontuan/acb-transaction-webhook/internal/storage"
)

func TestSSEStreamInitialStateAndLiveEvents(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway_sse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	hub := eventhub.New()
	cfg := config.Config{Production: false, DevelopmentSubject: "dev@example.com"}
	server := New(cfg, store).WithEventHub(hub)

	// Append an initial event to DB
	seq1, err := store.AppendJournalEvent(ctx, "ep1", "bank.transaction.credit", "txn_101", []byte(`{"amount":101,"transactionId":"txn_101"}`))
	if err != nil {
		t.Fatal(err)
	}

	// 1. Initial connect without cursor
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		server.Handler().ServeHTTP(w, req)
	}()

	// Wait briefly for handler to start and write initial state
	time.Sleep(50 * time.Millisecond)

	// Publish live event
	hub.Publish(eventhub.Event{
		Seq:         seq1 + 1,
		Epoch:       "ep1",
		EventType:   "bank.transaction.credit",
		AggregateID: "txn_102",
		Payload:     []byte(`{"amount":102,"transactionId":"txn_102"}`),
	})

	time.Sleep(50 * time.Millisecond)
	// Cancel request context to terminate stream
	cancel()
	<-doneCh

	body := w.Body.String()
	if !strings.Contains(body, "event: initial_state") {
		t.Fatalf("expected initial_state in SSE body, got: %s", body)
	}
	if !strings.Contains(body, "txn_102") {
		t.Fatalf("expected live event txn_102 in SSE body, got: %s", body)
	}
}

func TestSSEReplayFromCursor(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway_sse_replay.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	hub := eventhub.New()
	cfg := config.Config{Production: false, DevelopmentSubject: "dev@example.com"}
	server := New(cfg, store).WithEventHub(hub)

	// Append 2 events
	_, _ = store.AppendJournalEvent(ctx, "ep1", "bank.transaction.credit", "txn_201", []byte(`{"amount":201,"transactionId":"txn_201"}`))
	_, _ = store.AppendJournalEvent(ctx, "ep1", "bank.transaction.credit", "txn_202", []byte(`{"amount":202,"transactionId":"txn_202"}`))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	req.Header.Set("Last-Event-ID", "ep1:1")
	w := httptest.NewRecorder()

	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	server.Handler().ServeHTTP(w, req.WithContext(ctx))

	body := w.Body.String()
	// Should NOT contain txn_201 (seq 1), but SHOULD contain txn_202 (seq 2)
	if strings.Contains(body, "txn_201") {
		t.Errorf("expected txn_201 to be skipped with cursor ep1:1, got: %s", body)
	}
	if !strings.Contains(body, "txn_202") {
		t.Errorf("expected txn_202 replayed with cursor ep1:1, got: %s", body)
	}
}

func TestSSEResetStateOnInvalidCursor(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway_sse_reset.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	hub := eventhub.New()
	cfg := config.Config{Production: false, DevelopmentSubject: "dev@example.com"}
	server := New(cfg, store).WithEventHub(hub)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	req.Header.Set("Last-Event-ID", "ep999:invalid")
	w := httptest.NewRecorder()

	server.Handler().ServeHTTP(w, req)

	scanner := bufio.NewScanner(w.Body)
	var foundReset bool
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event: reset_state") {
			foundReset = true
			break
		}
	}
	if !foundReset {
		t.Fatalf("expected reset_state event, got body: %s", w.Body.String())
	}
}
