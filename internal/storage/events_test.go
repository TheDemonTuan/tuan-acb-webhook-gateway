package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func TestEmitTransactionEventAndDeliveries(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	conn, err := store.ConfigureConnection(ctx, "***1234")
	if err != nil {
		t.Fatal(err)
	}

	ep, err := store.CreateEndpointWithSecret(ctx, "Test Hook", "https://example.com/webhook")
	if err != nil || ep.Secret == "" {
		t.Fatalf("create ep failed: %+v %v", ep, err)
	}
	if err := store.SetEndpointStatus(ctx, ep.ID, "ACTIVE"); err != nil {
		t.Fatal(err)
	}

	txn, err := store.IngestTransaction(ctx, TransactionInput{
		ConnectionID:  conn.ID,
		SemanticKey:   "ACB:999",
		CanonicalHash: "hash999",
		TransactionAt: "2026-09-10",
		EffectiveAt:   "2026-09-10",
		Credit:        100000,
		ParserVersion: "v1",
	})
	if err != nil || !txn.Inserted {
		t.Fatalf("ingest failed: %+v %v", txn, err)
	}

	eventID, err := store.EmitTransactionEvent(ctx, txn.TransactionID, "bank.transaction.credit", "acb", "ACB:999", map[string]any{
		"amount": 100000,
	})
	if err != nil || eventID == "" {
		t.Fatalf("emit event failed: %v", err)
	}

	summary, err := store.DeliverySummary(ctx)
	if err != nil || summary.Pending != 1 {
		t.Fatalf("summary unexpected: %+v %v", summary, err)
	}

	url, secret, err := store.EndpointDetails(ctx, ep.ID)
	if err != nil || url != "https://example.com/webhook" || string(secret) != ep.Secret {
		t.Fatalf("endpoint details: %s %s %v", url, string(secret), err)
	}
}
