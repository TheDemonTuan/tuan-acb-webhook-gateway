package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func TestBackfillCanonicalDatesAndSourcePolicy(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "test_backfill.db")
	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	connID := "conn_backfill_test"
	if _, err := store.db.ExecContext(ctx, `
		INSERT INTO connections(id, state, generation, created_at, updated_at) 
		VALUES(?, 'MONITORING', 1, '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')
	`, connID); err != nil {
		t.Fatalf("insert connection: %v", err)
	}

	// Insert legacy row missing canonical day/iso
	legacyTxnID := "txn_legacy_1"
	if _, err := store.db.ExecContext(ctx, `
		INSERT INTO transactions(id, connection_id, semantic_key, canonical_hash, transaction_date, effective_date, debit, credit, balance, parser_version, first_seen_at)
		VALUES(?, ?, 'ACB:1111', 'hash1', '12/09/2026 10:32:15', '12/09/2026', 0, 100000, 500000, 'v1', '2026-09-12T10:33:00Z')
	`, legacyTxnID, connID); err != nil {
		t.Fatalf("insert legacy txn: %v", err)
	}

	// Run backfill
	updated, err := store.BackfillCanonicalDates(ctx)
	if err != nil {
		t.Fatalf("BackfillCanonicalDates: %v", err)
	}
	if updated != 1 {
		t.Errorf("expected 1 row updated, got %d", updated)
	}

	var day, iso, precision string
	err = store.db.QueryRowContext(ctx, `
		SELECT transaction_day, transaction_at_iso, date_precision 
		FROM transactions WHERE id = ?
	`, legacyTxnID).Scan(&day, &iso, &precision)
	if err != nil {
		t.Fatalf("query backfilled row: %v", err)
	}
	if day != "2026-09-12" {
		t.Errorf("expected day 2026-09-12, got %q", day)
	}
	if precision != "datetime" {
		t.Errorf("expected precision datetime, got %q", precision)
	}

	// Re-run backfill should update 0 rows
	updated2, err := store.BackfillCanonicalDates(ctx)
	if err != nil {
		t.Fatalf("BackfillCanonicalDates second run: %v", err)
	}
	if updated2 != 0 {
		t.Errorf("expected 0 rows updated on rerun, got %d", updated2)
	}

	// Test IngestTransactionsBatchWithSource FILTER_SYNC
	filterSyncItems := []BatchTransactionItem{
		{
			Number:        "2222",
			Credit:        50000,
			Debit:         0,
			TransactionAt: "01/02/2026",
			EffectiveAt:   "01/02/2026",
			Description:   "Old history sync",
		},
	}
	res, err := store.IngestTransactionsBatchWithSource(ctx, connID, 1, "123***789", filterSyncItems, false, "FILTER_SYNC")
	if err != nil {
		t.Fatalf("IngestTransactionsBatchWithSource FILTER_SYNC: %v", err)
	}
	if res.InsertedCount != 1 {
		t.Errorf("expected 1 inserted, got %d", res.InsertedCount)
	}
	// For FILTER_SYNC, NewEvents should be empty (no voice announcements!)
	if len(res.NewEvents) != 0 {
		t.Errorf("expected 0 NewEvents for FILTER_SYNC, got %d", len(res.NewEvents))
	}

	var filterDay, filterSource string
	err = store.db.QueryRowContext(ctx, `
		SELECT transaction_day, ingest_source 
		FROM transactions WHERE semantic_key = 'ACB:2222'
	`).Scan(&filterDay, &filterSource)
	if err != nil {
		t.Fatalf("query FILTER_SYNC row: %v", err)
	}
	if filterDay != "2026-02-01" {
		t.Errorf("expected filterDay 2026-02-01, got %q", filterDay)
	}
	if filterSource != "FILTER_SYNC" {
		t.Errorf("expected filterSource FILTER_SYNC, got %q", filterSource)
	}
}
