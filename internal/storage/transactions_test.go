package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func TestIngestTransactionDeduplicatesAndQuarantinesConflict(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	connection, err := store.ConfigureConnection(ctx, "***1234")
	if err != nil {
		t.Fatal(err)
	}
	input := TransactionInput{ConnectionID: connection.ID, SemanticKey: "ACB:123", CanonicalHash: "first", TransactionAt: "2026-09-10", EffectiveAt: "2026-09-10", Credit: 50000, ParserVersion: "v1"}
	first, err := store.IngestTransaction(ctx, input)
	if err != nil || !first.Inserted {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	second, err := store.IngestTransaction(ctx, input)
	if err != nil || second.Inserted || second.Conflict || second.TransactionID != first.TransactionID {
		t.Fatalf("second=%+v err=%v", second, err)
	}
	input.CanonicalHash = "changed"
	conflict, err := store.IngestTransaction(ctx, input)
	if err != nil || !conflict.Conflict || conflict.Inserted {
		t.Fatalf("conflict=%+v err=%v", conflict, err)
	}
	var quarantined int
	if err := store.DB().QueryRowContext(ctx, `SELECT count(*) FROM transaction_quarantine`).Scan(&quarantined); err != nil || quarantined != 1 {
		t.Fatalf("quarantine=%d err=%v", quarantined, err)
	}
}

func TestIngestTransactionsBatchAtomicAndGenerationFence(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "gateway_batch.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	conn, err := store.ConfigureConnection(ctx, "***5678")
	if err != nil {
		t.Fatal(err)
	}
	// Transition to MONITORING state
	_, err = store.DB().ExecContext(ctx, "UPDATE connections SET state = 'MONITORING', generation = 1 WHERE id = ?", conn.ID)
	if err != nil {
		t.Fatal(err)
	}

	ep, err := store.CreateEndpointWithSecret(ctx, "Hook 1", "https://example.com/webhook")
	if err != nil {
		t.Fatal(err)
	}
	_ = store.SetEndpointStatus(ctx, ep.ID, "ACTIVE")

	items := []BatchTransactionItem{
		{Number: "1001", Credit: 150000, Debit: 0, TransactionAt: "2026-09-12 10:00:00", EffectiveAt: "2026-09-12", Description: "Deposit 1"},
		{Number: "1002", Credit: 0, Debit: 50000, TransactionAt: "2026-09-12 10:05:00", EffectiveAt: "2026-09-12", Description: "Withdraw 1"},
	}

	// 1. Generation fence mismatch test
	_, err = store.IngestTransactionsBatch(ctx, conn.ID, 999, "***5678", items, false)
	if err == nil {
		t.Fatal("expected generation fence error, got nil")
	}

	// 2. Normal batch ingest with expected generation 1
	res, err := store.IngestTransactionsBatch(ctx, conn.ID, 1, "***5678", items, false)
	if err != nil {
		t.Fatalf("batch ingest failed: %v", err)
	}
	if res.InsertedCount != 2 {
		t.Fatalf("expected 2 inserted, got %d", res.InsertedCount)
	}
	// Only credit item 1001 should produce an event
	if len(res.NewEvents) != 1 {
		t.Fatalf("expected 1 event, got %d", len(res.NewEvents))
	}
	if res.NewEvents[0].JournalSeq <= 0 {
		t.Fatalf("expected journal seq > 0, got %d", res.NewEvents[0].JournalSeq)
	}

	// Verify deliveries created in DB
	var deliveryCount int
	_ = store.DB().QueryRowContext(ctx, "SELECT count(*) FROM deliveries WHERE status = 'PENDING'").Scan(&deliveryCount)
	if deliveryCount != 1 {
		t.Fatalf("expected 1 pending delivery, got %d", deliveryCount)
	}

	// 3. Baseline mode test: should insert transactions with baseline_state='BASELINE' and NO events/deliveries
	baselineItems := []BatchTransactionItem{
		{Number: "1003", Credit: 500000, Debit: 0, TransactionAt: "2026-09-12 09:00:00", EffectiveAt: "2026-09-12", Description: "Historical Deposit"},
	}
	baseRes, err := store.IngestTransactionsBatch(ctx, conn.ID, 1, "***5678", baselineItems, true)
	if err != nil {
		t.Fatalf("baseline ingest failed: %v", err)
	}
	if baseRes.InsertedCount != 1 || len(baseRes.NewEvents) != 0 {
		t.Fatalf("expected 1 inserted and 0 events for baseline, got inserted=%d events=%d", baseRes.InsertedCount, len(baseRes.NewEvents))
	}

	var baseState string
	_ = store.DB().QueryRowContext(ctx, "SELECT baseline_state FROM transactions WHERE semantic_key = 'ACB:1003'").Scan(&baseState)
	if baseState != "BASELINE" {
		t.Fatalf("expected baseline_state BASELINE, got %s", baseState)
	}

	// Deliveries count should still be 1 (no new delivery for baseline item)
	_ = store.DB().QueryRowContext(ctx, "SELECT count(*) FROM deliveries WHERE status = 'PENDING'").Scan(&deliveryCount)
	if deliveryCount != 1 {
		t.Fatalf("expected deliveries still 1, got %d", deliveryCount)
	}
}
