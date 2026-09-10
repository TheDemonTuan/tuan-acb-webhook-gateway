package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func TestPollRunFencesStaleConnection(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.TransitionConnection(ctx, "resume"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().ExecContext(ctx, `UPDATE connections SET state='MONITORING'`); err != nil {
		t.Fatal(err)
	}
	poll, err := store.StartPoll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.TransitionConnection(ctx, "pause"); err != nil {
		t.Fatal(err)
	}
	poll.Status = "AUTH_REQUIRED"
	if err := store.FinishPoll(ctx, poll); err == nil {
		t.Fatal("stale poll changed a newer connection")
	}
}
