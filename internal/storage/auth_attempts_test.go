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

func TestAuthAttemptLookupAndOwnership(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}

	attempt, err := store.StartAuthAttempt(ctx, "alice@example.com", 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	// Active and unexpired lookup succeeds for owner
	got, err := store.AuthAttemptForOwner(ctx, attempt.ID, "alice@example.com")
	if err != nil || got.ID != attempt.ID {
		t.Fatalf("AuthAttemptForOwner failed: got=%+v, err=%v", got, err)
	}

	// Wrong owner rejected
	if _, err := store.AuthAttemptForOwner(ctx, attempt.ID, "bob@example.com"); err == nil {
		t.Fatal("expected error for wrong owner in AuthAttemptForOwner")
	}
	if _, err := store.AuthAttemptStatusForOwner(ctx, attempt.ID, "bob@example.com"); err == nil {
		t.Fatal("expected error for wrong owner in AuthAttemptStatusForOwner")
	}

	// Status lookup succeeds for owner
	gotStatus, err := store.AuthAttemptStatusForOwner(ctx, attempt.ID, "alice@example.com")
	if err != nil || gotStatus.ID != attempt.ID {
		t.Fatalf("AuthAttemptStatusForOwner failed: got=%+v, err=%v", gotStatus, err)
	}

	// Finish attempt as CANCELLED
	if err := store.FinishAuthAttempt(ctx, attempt.ID, "CANCELLED"); err != nil {
		t.Fatal(err)
	}

	// Terminal attempt: AuthAttemptForOwner must reject (protects VNC)
	if _, err := store.AuthAttemptForOwner(ctx, attempt.ID, "alice@example.com"); err == nil {
		t.Fatal("AuthAttemptForOwner should reject terminal attempt")
	}

	// Terminal attempt: AuthAttemptStatusForOwner must return terminal attempt
	gotTerminal, err := store.AuthAttemptStatusForOwner(ctx, attempt.ID, "alice@example.com")
	if err != nil || gotTerminal.Status != "CANCELLED" {
		t.Fatalf("AuthAttemptStatusForOwner terminal failed: got=%+v, err=%v", gotTerminal, err)
	}
}
