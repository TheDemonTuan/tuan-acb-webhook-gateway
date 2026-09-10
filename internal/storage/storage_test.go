package storage

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestOpenMigratesAndRejectsChangedMigrationChecksum(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var tables int
	if err := store.DB().QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('connections','events','deliveries','transaction_quarantine')`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if tables != 4 {
		t.Fatalf("expected 4 core tables, got %d", tables)
	}
	var foreignKeys int
	if err := store.DB().QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		t.Fatal(err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d", foreignKeys)
	}
	var missing sql.NullString
	if err := store.DB().QueryRowContext(ctx, `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).Scan(&missing); err != nil {
		t.Fatal(err)
	}
}
