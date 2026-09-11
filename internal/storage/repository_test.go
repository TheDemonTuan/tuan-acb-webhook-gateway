package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func TestConnectionAndEndpointLifecycle(t *testing.T) {
	s, err := Open(context.Background(), filepath.Join(t.TempDir(), "x.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c, err := s.ConfigureConnection(context.Background(), "***1234")
	if err != nil {
		t.Fatal(err)
	}
	if c.State != "AUTH_REQUIRED" {
		t.Fatal(c.State)
	}
	if _, err := s.TransitionConnection(context.Background(), "pause"); err != nil {
		t.Fatal(err)
	}
	c, err = s.Connection(context.Background())
	if err != nil || c.State != "PAUSED" {
		t.Fatal(c, err)
	}
	e, err := s.CreateEndpoint(context.Background(), "test", "https://events.example.com/bank")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetEndpointStatus(context.Background(), e.ID, "ACTIVE"); err != nil {
		t.Fatal(err)
	}
	items, err := s.Endpoints(context.Background())
	if err != nil || len(items) != 1 || items[0].Status != "ACTIVE" {
		t.Fatal(items, err)
	}
}

func TestTransitionConnectionRejectsSyncAndPreservesState(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "test_sync.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if _, err := s.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB().ExecContext(ctx, "UPDATE connections SET state='MONITORING'"); err != nil {
		t.Fatal(err)
	}
	before, err := s.Connection(ctx)
	if err != nil {
		t.Fatal(err)
	}

	_, err = s.TransitionConnection(ctx, "sync")
	if err == nil || err.Error() != "unsupported action" {
		t.Fatalf("expected unsupported action error, got %v", err)
	}

	after, err := s.Connection(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.State != before.State || after.Generation != before.Generation {
		t.Fatalf("sync action mutated connection: before=%+v after=%+v", before, after)
	}
}
