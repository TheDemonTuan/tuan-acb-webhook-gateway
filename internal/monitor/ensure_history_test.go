package monitor

import (
	"context"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/thedemontuan/acb-transaction-webhook/internal/acb"
	"github.com/thedemontuan/acb-transaction-webhook/internal/storage"
)

type mockHistoryClient struct {
	bootstrapCalls atomic.Int32
	historyCalls   atomic.Int32
}

func (m *mockHistoryClient) Bootstrap(ctx context.Context) (acb.Response, error) {
	m.bootstrapCalls.Add(1)
	time.Sleep(20 * time.Millisecond)
	body := `<form action="/history" method="POST">
		<input type="hidden" name="dse_operationName" value="op1" />
		<input type="hidden" name="dse_processorState" value="ps1" />
		<input type="hidden" name="AccountNbr" value="123456" />
	</form>`
	return acb.Response{StatusCode: 200, Body: body, Kind: acb.AccountDetailPage}, nil
}

func (m *mockHistoryClient) History(ctx context.Context, endpoint string, fields map[string]string) (acb.Response, error) {
	m.historyCalls.Add(1)
	time.Sleep(50 * time.Millisecond)
	body := `<table>
		<tr><th>Số GD</th><th>Ngày giao dịch</th><th>Ghi nợ</th><th>Ghi có</th><th>Số dư</th><th>Nội dung giao dịch</th></tr>
		<tr><td>TXN001</td><td>06/09/2026</td><td>0</td><td>50,000</td><td>100,000</td><td>Test transfer</td></tr>
	</table>`
	return acb.Response{StatusCode: 200, Body: body, Kind: acb.HistoryPage}, nil
}

func TestMonitorEnsureHistoryCoalescing(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "test_mon_ensure.db")
	store, err := storage.Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	connID := "conn_mon_ensure"
	if _, err := store.DB().ExecContext(ctx, `
		INSERT INTO connections(id, state, generation, account_masked, created_at, updated_at)
		VALUES(?, 'MONITORING', 1, '123456', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')
	`, connID); err != nil {
		t.Fatalf("insert connection: %v", err)
	}

	mockClient := &mockHistoryClient{}
	mon := New(store, mockClient, 5*time.Second, 15*time.Second)

	var wg sync.WaitGroup
	clients := 10
	wg.Add(clients)

	fromDay := "2026-09-06"
	toDay := "2026-09-12"

	for i := 0; i < clients; i++ {
		go func() {
			defer wg.Done()
			_, _ = mon.EnsureHistory(ctx, fromDay, toDay)
		}()
	}
	wg.Wait()

	// 10 concurrent requests for the exact same range should coalesce into 1 upstream history call!
	historyCalls := mockClient.historyCalls.Load()
	if historyCalls != 1 {
		t.Errorf("expected exactly 1 upstream history call due to coalescing, got %d", historyCalls)
	}

	// Next call immediately after should hit coverage cache and make 0 upstream calls!
	mockClient.historyCalls.Store(0)
	mockClient.bootstrapCalls.Store(0)

	_, err = mon.EnsureHistory(ctx, fromDay, toDay)
	if err != nil {
		t.Fatalf("EnsureHistory cached call error: %v", err)
	}
	if mockClient.historyCalls.Load() != 0 {
		t.Errorf("expected 0 upstream calls for cached coverage, got %d", mockClient.historyCalls.Load())
	}
}
