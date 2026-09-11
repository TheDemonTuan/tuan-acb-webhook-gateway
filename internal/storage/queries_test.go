package storage

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestCompleteAuthSessionRejectsStaleGeneration(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if _, err = store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}
	attempt, err := store.StartAuthAttempt(ctx, "owner", 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB().ExecContext(ctx, `UPDATE connections SET generation=generation+1 WHERE id=?`, attempt.ConnectionID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.CompleteAuthSession(ctx, attempt.ID, []byte("stale_session")); err == nil {
		t.Fatal("expected stale generation to be rejected")
	}
}

func TestTransactionCursorPaginationIsStable(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "pagination.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	connection, _ := store.ConfigureConnection(ctx, "***1234")
	for i := 0; i < 5; i++ {
		_, err := store.IngestTransaction(ctx, TransactionInput{
			ConnectionID: connection.ID, SemanticKey: fmt.Sprintf("ACB:%d", i), CanonicalHash: fmt.Sprintf("hash%d", i),
			TransactionAt: "2026-09-11", EffectiveAt: "2026-09-11", Credit: int64(i + 1), ParserVersion: "v1",
		})
		if err != nil {
			t.Fatal(err)
		}
		time.Sleep(time.Millisecond)
	}
	first, err := store.ListTransactionsPage(ctx, 2, "")
	if err != nil || len(first.Items) != 2 || first.NextCursor == "" {
		t.Fatalf("unexpected first page: %+v %v", first, err)
	}
	second, err := store.ListTransactionsPage(ctx, 2, first.NextCursor)
	if err != nil || len(second.Items) != 2 || second.NextCursor == "" {
		t.Fatalf("unexpected second page: %+v %v", second, err)
	}
	if first.Items[1].ID == second.Items[0].ID {
		t.Fatal("cursor returned duplicate row")
	}
	if _, err := store.ListTransactionsPage(ctx, 2, "not-a-cursor"); err == nil {
		t.Fatal("expected invalid cursor error")
	}
}

func TestCompleteAuthSessionAndListingQueries(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	conn, _ := store.ConfigureConnection(ctx, "***1234")
	attempt, err := store.StartAuthAttempt(ctx, "owner", 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	updatedConn, err := store.CompleteAuthSession(ctx, attempt.ID, []byte("session_cookies_data"))
	if err != nil || updatedConn.State != "MONITORING" {
		t.Fatalf("complete auth session failed: %+v %v", updatedConn, err)
	}

	// Ingest a transaction
	_, _ = store.IngestTransaction(ctx, TransactionInput{
		ConnectionID:  conn.ID,
		SemanticKey:   "ACB:12345",
		CanonicalHash: "hash12345",
		TransactionAt: "2026-09-10",
		EffectiveAt:   "2026-09-10",
		Credit:        250000,
		Description:   []byte("Test Listing"),
		ParserVersion: "v1",
	})

	txns, err := store.ListTransactions(ctx, 10)
	if err != nil || len(txns) != 1 || txns[0].Credit != 250000 || txns[0].Description != "Test Listing" {
		t.Fatalf("list transactions unexpected: %+v %v", txns, err)
	}

	// Audit
	_ = store.Audit(ctx, "owner", "OWNER", "test.action", "target", "req1")
	logs, err := store.ListAuditLogs(ctx, 10)
	if err != nil || len(logs) != 1 || logs[0].Action != "test.action" {
		t.Fatalf("list audit unexpected: %+v %v", logs, err)
	}

	// Deliveries
	delList, err := store.ListDeliveries(ctx, 10)
	if err != nil || len(delList) != 0 {
		t.Fatalf("empty deliveries check failed: %+v", delList)
	}
}
