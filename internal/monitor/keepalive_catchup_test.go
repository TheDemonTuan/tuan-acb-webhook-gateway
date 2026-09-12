package monitor

import (
	"context"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/thedemontuan/acb-transaction-webhook/internal/acb"
	"github.com/thedemontuan/acb-transaction-webhook/internal/storage"
)

type keepaliveMockClient struct {
	bootstrapCalls atomic.Int32
	historyCalls   atomic.Int32
}

func (m *keepaliveMockClient) Bootstrap(ctx context.Context) (acb.Response, error) {
	m.bootstrapCalls.Add(1)
	body := `<form action="/history" method="POST">
		<input type="hidden" name="dse_operationName" value="op1" />
		<input type="hidden" name="dse_processorState" value="ps1" />
		<input type="hidden" name="AccountNbr" value="123456" />
	</form>`
	return acb.Response{StatusCode: 200, Body: body, Kind: acb.AccountDetailPage}, nil
}

func (m *keepaliveMockClient) History(ctx context.Context, endpoint string, fields map[string]string) (acb.Response, error) {
	m.historyCalls.Add(1)
	body := `<table>
		<tr><th>Số GD</th><th>Ngày giao dịch</th><th>Ghi nợ</th><th>Ghi có</th><th>Số dư</th><th>Nội dung giao dịch</th></tr>
		<tr><td>TXN_A</td><td>12/09/2026 02:00:00</td><td>0</td><td>100,000</td><td>500,000</td><td>Transfer A</td></tr>
		<tr><td>TXN_B</td><td>12/09/2026 06:00:00</td><td>0</td><td>200,000</td><td>700,000</td><td>Transfer B</td></tr>
	</table>`
	return acb.Response{StatusCode: 200, Body: body, Kind: acb.HistoryPage}, nil
}

func TestKeepaliveCallsBootstrapAndNeverCallsHistory(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "test_mon_keepalive.db")
	store, err := storage.Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	connID := "conn_keepalive"
	if _, err := store.DB().ExecContext(ctx, `
		INSERT INTO connections(id, state, generation, account_masked, created_at, updated_at)
		VALUES(?, 'MONITORING', 1, '123456', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')
	`, connID); err != nil {
		t.Fatalf("insert connection: %v", err)
	}

	mockClient := &keepaliveMockClient{}
	mon := New(store, mockClient, 5*time.Second, 15*time.Second)

	// Run pollKeepalive
	err = mon.pollKeepalive(ctx)
	if err != nil {
		t.Fatalf("pollKeepalive failed: %v", err)
	}

	if mockClient.bootstrapCalls.Load() != 1 {
		t.Errorf("expected Bootstrap calls = 1, got %d", mockClient.bootstrapCalls.Load())
	}
	if mockClient.historyCalls.Load() != 0 {
		t.Errorf("expected History calls = 0 during keepalive, got %d", mockClient.historyCalls.Load())
	}
}

func TestCatchUpIngestsTransactionsWithCatchUpSourceAndWebhooks(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "test_mon_catchup.db")
	store, err := storage.Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	connID := "conn_catchup"
	if _, err := store.DB().ExecContext(ctx, `
		INSERT INTO connections(id, state, generation, account_masked, created_at, updated_at)
		VALUES(?, 'MONITORING', 1, '123456', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')
	`, connID); err != nil {
		t.Fatalf("insert connection: %v", err)
	}

	// Create active webhook endpoint to verify deliveries are created
	ep, err := store.CreateEndpointWithSecret(ctx, "Test Endpoint", "https://example.com/webhook")
	if err != nil {
		t.Fatalf("CreateEndpointWithSecret: %v", err)
	}
	if err := store.SetEndpointStatus(ctx, ep.ID, "ACTIVE"); err != nil {
		t.Fatalf("SetEndpointStatus: %v", err)
	}

	mockClient := &keepaliveMockClient{}
	mon := New(store, mockClient, 5*time.Second, 15*time.Second)

	var receivedEvents []storage.EventNotification
	mon.WithEventNotifier(func(events []storage.EventNotification) {
		receivedEvents = append(receivedEvents, events...)
	})

	// Run catchUp
	err = mon.catchUp(ctx)
	if err != nil {
		t.Fatalf("catchUp failed: %v", err)
	}

	if len(receivedEvents) != 2 {
		t.Fatalf("expected 2 new events emitted on catchup, got %d", len(receivedEvents))
	}

	// Verify checkpoint was updated
	cp, err := store.GetCheckpoint(ctx, connID)
	if err != nil || cp == nil {
		t.Fatalf("expected checkpoint to be recorded, got err=%v, cp=%+v", err, cp)
	}
	if cp.CoverageTo == "" {
		t.Errorf("expected checkpoint CoverageTo not empty")
	}

	// Transactions A and B should be ingested with source = 'CATCH_UP'
	var sourceA, sourceB string
	err = store.DB().QueryRowContext(ctx, `SELECT ingest_source FROM transactions WHERE semantic_key = 'ACB:TXN_A'`).Scan(&sourceA)
	if err != nil {
		t.Fatalf("query TXN_A: %v", err)
	}
	if sourceA != "CATCH_UP" {
		t.Errorf("expected source CATCH_UP for TXN_A, got %q", sourceA)
	}

	err = store.DB().QueryRowContext(ctx, `SELECT ingest_source FROM transactions WHERE semantic_key = 'ACB:TXN_B'`).Scan(&sourceB)
	if err != nil {
		t.Fatalf("query TXN_B: %v", err)
	}
	if sourceB != "CATCH_UP" {
		t.Errorf("expected source CATCH_UP for TXN_B, got %q", sourceB)
	}

	// Deliveries should be created for both transactions
	var deliveryCount int
	err = store.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM deliveries WHERE endpoint_id = ?`, ep.ID).Scan(&deliveryCount)
	if err != nil {
		t.Fatalf("query deliveries: %v", err)
	}
	if deliveryCount != 2 {
		t.Errorf("expected 2 webhook deliveries created during catchup, got %d", deliveryCount)
	}
}
