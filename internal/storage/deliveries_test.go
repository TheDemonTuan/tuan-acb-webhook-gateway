package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestClaimDeliveryUsesLeaseAndClaimToken(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	nowAt := time.Now().UTC().Truncate(time.Second)
	_, err = store.DB().ExecContext(ctx, `INSERT INTO webhook_endpoints(id,name,status,current_revision,created_at,updated_at) VALUES('endpoint','test','ACTIVE',1,?,?)`, now(), now())
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.DB().ExecContext(ctx, `INSERT INTO events(id,event_type,payload,payload_hash,created_at) VALUES('event','bank.transaction.credit',X'7B7D','hash',?)`, now())
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.DB().ExecContext(ctx, `INSERT INTO deliveries(id,event_id,endpoint_id,endpoint_revision,key_id,status,next_attempt_at,created_at,updated_at) VALUES('delivery','event','endpoint',1,'k1','PENDING',?,?,?)`, nowAt.Format(time.RFC3339Nano), now(), now())
	if err != nil {
		t.Fatal(err)
	}
	delivery, err := store.ClaimDelivery(ctx, nowAt, time.Minute)
	if err != nil || delivery.ClaimToken == "" || delivery.Status != "IN_FLIGHT" || delivery.Attempts != 1 {
		t.Fatalf("delivery=%+v err=%v", delivery, err)
	}
	if _, err := store.ClaimDelivery(ctx, nowAt, time.Minute); err == nil {
		t.Fatal("delivery was claimed twice")
	}
	if err := store.CompleteDelivery(ctx, delivery, false, nowAt.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteDelivery(ctx, delivery, true, nowAt); err == nil {
		t.Fatal("old claim completed twice")
	}
}
