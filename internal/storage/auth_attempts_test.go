package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestAuthAttemptFencesConnectionGeneration(t *testing.T) {
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
	attempt, err := store.StartAuthAttempt(ctx, "owner", time.Minute)
	if err != nil || attempt.Generation != connection.Generation+1 {
		t.Fatalf("attempt=%+v err=%v", attempt, err)
	}
	if _, err := store.StartAuthAttempt(ctx, "owner", time.Minute); err == nil {
		t.Fatal("allowed a concurrent auth attempt")
	}
	if err := store.FinishAuthAttempt(ctx, attempt.ID, "CANCELLED"); err != nil {
		t.Fatal(err)
	}
	updated, err := store.Connection(ctx)
	if err != nil || updated.State != "AUTH_REQUIRED" || updated.Generation != attempt.Generation+1 {
		t.Fatalf("connection=%+v err=%v", updated, err)
	}
}
