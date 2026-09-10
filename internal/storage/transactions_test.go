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
