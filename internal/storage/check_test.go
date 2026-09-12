package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func TestCheckIntegrity(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "test_check.db")
	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()

	rep, err := store.CheckIntegrity(ctx)
	if err != nil {
		t.Fatalf("check integrity failed: %v", err)
	}
	if !rep.IntegrityOK {
		t.Errorf("expected integrity ok, got %v: %s", rep.IntegrityOK, rep.IntegrityMessage)
	}
	if rep.MigrationsApplied == 0 {
		t.Errorf("expected migrations applied > 0, got %d", rep.MigrationsApplied)
	}
}
