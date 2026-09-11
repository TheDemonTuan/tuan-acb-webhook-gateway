package monitor

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/thedemontuan/tuan-bank-gateway/internal/acb"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

type mockBankClient struct {
	getResp     acb.Response
	historyResp acb.Response
}

func (m *mockBankClient) Get(ctx context.Context, endpoint string) (acb.Response, error) {
	return m.getResp, nil
}

func (m *mockBankClient) History(ctx context.Context, endpoint string, fields map[string]string) (acb.Response, error) {
	return m.historyResp, nil
}

const mockHistoryHTML = `
<table>
  <tr>
    <th>Ngày hiệu lực</th>
    <th>Ngày giao dịch</th>
    <th>Số GD</th>
    <th>Ghi nợ</th>
    <th>Ghi có</th>
    <th>Số dư</th>
    <th>Nội dung giao dịch</th>
  </tr>
  <tr>
    <td>10/09/2026</td>
    <td>10/09/2026</td>
    <td>7788</td>
    <td>-</td>
    <td>150.000</td>
    <td>2.000.000</td>
    <td>Test Nap Tien</td>
  </tr>
</table>
`

func TestMonitorPollHappyPath(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, _ = store.ConfigureConnection(ctx, "***1234")
	_, _ = store.DB().ExecContext(ctx, `UPDATE connections SET state='MONITORING'`)

	ep, err := store.CreateEndpointWithSecret(ctx, "Webhook Receiver", "https://example.com/receiver")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetEndpointStatus(ctx, ep.ID, "ACTIVE"); err != nil {
		t.Fatal(err)
	}

	mock := &mockBankClient{
		getResp: acb.Response{
			StatusCode: 200,
			Kind:       acb.HistoryPage,
			Body:       mockHistoryHTML,
		},
	}

	m := New(store, mock, 5*time.Second)
	err = m.PollOnce(ctx)
	if err != nil {
		t.Fatalf("poll failed: %v", err)
	}

	summary, err := store.DeliverySummary(ctx)
	if err != nil || summary.Pending != 1 {
		t.Fatalf("expected 1 pending delivery, got: %+v %v", summary, err)
	}

	// Ingesting again should deduplicate and not queue a second delivery
	err = m.PollOnce(ctx)
	if err != nil {
		t.Fatalf("second poll failed: %v", err)
	}

	summary, err = store.DeliverySummary(ctx)
	if err != nil || summary.Pending != 1 {
		t.Fatalf("expected still 1 pending delivery (deduped), got: %+v", summary)
	}
	_ = ep
}

func TestMonitorSessionExpired(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, _ = store.ConfigureConnection(ctx, "***1234")
	_, _ = store.DB().ExecContext(ctx, `UPDATE connections SET state='MONITORING'`)

	mock := &mockBankClient{
		getResp: acb.Response{
			StatusCode: 200,
			Kind:       acb.LoginPage,
			Body:       `<input name="username"><input name="password">`,
		},
	}

	m := New(store, mock, 5*time.Second)
	err = m.PollOnce(ctx)
	if err != nil {
		t.Fatalf("poll failed: %v", err)
	}

	conn, err := store.Connection(ctx)
	if err != nil || conn.State != "AUTH_REQUIRED" {
		t.Fatalf("expected state AUTH_REQUIRED, got %+v", conn)
	}
}

type countingMockClient struct {
	getFunc     func(ctx context.Context, endpoint string) (acb.Response, error)
	historyFunc func(ctx context.Context, endpoint string, fields map[string]string) (acb.Response, error)
}

func (c *countingMockClient) Get(ctx context.Context, endpoint string) (acb.Response, error) {
	if c.getFunc != nil {
		return c.getFunc(ctx, endpoint)
	}
	return acb.Response{StatusCode: 200, Kind: acb.HistoryPage, Body: mockHistoryHTML}, nil
}

func (c *countingMockClient) History(ctx context.Context, endpoint string, fields map[string]string) (acb.Response, error) {
	if c.historyFunc != nil {
		return c.historyFunc(ctx, endpoint, fields)
	}
	return acb.Response{StatusCode: 200, Kind: acb.HistoryPage, Body: mockHistoryHTML}, nil
}

func TestRequestSyncRejectsNonMonitoring(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "test_sync_reject.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	mock := &mockBankClient{}
	m := New(store, mock, 5*time.Second)

	// No connection configured
	err = m.RequestSync(ctx)
	if !errors.Is(err, ErrSyncUnavailable) {
		t.Fatalf("expected ErrSyncUnavailable on missing connection, got: %v", err)
	}

	// AUTH_REQUIRED state
	if _, err := store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}
	err = m.RequestSync(ctx)
	if !errors.Is(err, ErrSyncUnavailable) {
		t.Fatalf("expected ErrSyncUnavailable on AUTH_REQUIRED, got: %v", err)
	}

	// PAUSED state
	if _, err := store.TransitionConnection(ctx, "pause"); err != nil {
		t.Fatal(err)
	}
	err = m.RequestSync(ctx)
	if !errors.Is(err, ErrSyncUnavailable) {
		t.Fatalf("expected ErrSyncUnavailable on PAUSED, got: %v", err)
	}

	// MONITORING state
	if _, err := store.DB().ExecContext(ctx, "UPDATE connections SET state='MONITORING'"); err != nil {
		t.Fatal(err)
	}
	err = m.RequestSync(ctx)
	if err != nil {
		t.Fatalf("expected nil error on MONITORING, got: %v", err)
	}
}

func TestRequestSyncPreservesGenerationAndSession(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "test_sync_preserve.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if _, err := store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().ExecContext(ctx, "UPDATE connections SET state='MONITORING'"); err != nil {
		t.Fatal(err)
	}
	before, err := store.Connection(ctx)
	if err != nil {
		t.Fatal(err)
	}

	mock := &mockBankClient{
		getResp: acb.Response{
			StatusCode: 200,
			Kind:       acb.HistoryPage,
			Body:       mockHistoryHTML,
		},
	}

	m := New(store, mock, 5*time.Second)

	// Run monitor in background
	go m.Run(ctx)

	if err := m.RequestSync(ctx); err != nil {
		t.Fatalf("RequestSync failed: %v", err)
	}

	// Wait for poll to complete
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		runs, _ := store.ListPollRuns(ctx, 10)
		if len(runs) > 0 && runs[0].Status == "SUCCEEDED" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	after, err := store.Connection(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.Generation != before.Generation {
		t.Fatalf("generation mutated: before=%d after=%d", before.Generation, after.Generation)
	}
	if after.State != "MONITORING" {
		t.Fatalf("state mutated: before=%s after=%s", before.State, after.State)
	}
}

func TestRequestSyncActualQueuedPoll(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "test_sync_queued.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if _, err := store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().ExecContext(ctx, "UPDATE connections SET state='MONITORING'"); err != nil {
		t.Fatal(err)
	}

	ep, err := store.CreateEndpointWithSecret(ctx, "Webhook Receiver", "https://example.com/receiver")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetEndpointStatus(ctx, ep.ID, "ACTIVE"); err != nil {
		t.Fatal(err)
	}

	var callCount atomic.Int32
	mock := &countingMockClient{
		getFunc: func(ctx context.Context, endpoint string) (acb.Response, error) {
			callCount.Add(1)
			return acb.Response{StatusCode: 200, Kind: acb.HistoryPage, Body: mockHistoryHTML}, nil
		},
	}

	// Long poll interval so periodic poll won't fire during test
	m := New(store, mock, 1*time.Hour)
	go m.Run(ctx)

	if err := m.RequestSync(ctx); err != nil {
		t.Fatalf("RequestSync failed: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if callCount.Load() > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if callCount.Load() != 1 {
		t.Fatalf("expected 1 call from queued sync, got %d", callCount.Load())
	}

	summary, err := store.DeliverySummary(ctx)
	if err != nil || summary.Pending != 1 {
		t.Fatalf("expected 1 pending delivery from queued poll, got %+v %v", summary, err)
	}
}

func TestRequestSyncStaleSyncSkipped(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "test_sync_stale.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if _, err := store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().ExecContext(ctx, "UPDATE connections SET state='MONITORING'"); err != nil {
		t.Fatal(err)
	}

	var callCount atomic.Int32
	mock := &countingMockClient{
		getFunc: func(ctx context.Context, endpoint string) (acb.Response, error) {
			callCount.Add(1)
			return acb.Response{StatusCode: 200, Kind: acb.HistoryPage, Body: mockHistoryHTML}, nil
		},
	}

	m := New(store, mock, 1*time.Hour)

	// Enqueue sync while in MONITORING (gen 0)
	if err := m.RequestSync(ctx); err != nil {
		t.Fatalf("RequestSync failed: %v", err)
	}

	// Change connection to PAUSED (increments generation and changes state) before Run consumes it
	if _, err := store.TransitionConnection(ctx, "pause"); err != nil {
		t.Fatal(err)
	}

	// Now start Run. It consumes the queued sync, but under the lock sees ID/gen/state mismatch
	go m.Run(ctx)

	// Wait briefly to allow Run to process the queued sync
	time.Sleep(150 * time.Millisecond)

	if callCount.Load() != 0 {
		t.Fatalf("expected 0 calls for stale sync, got %d", callCount.Load())
	}

	runs, err := store.ListPollRuns(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 0 {
		t.Fatalf("expected 0 poll runs for stale sync, got %d", len(runs))
	}
}

func TestRequestSyncCoalescing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "test_sync_coalesce.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if _, err := store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().ExecContext(ctx, "UPDATE connections SET state='MONITORING'"); err != nil {
		t.Fatal(err)
	}

	var callCount atomic.Int32
	mock := &countingMockClient{
		getFunc: func(ctx context.Context, endpoint string) (acb.Response, error) {
			callCount.Add(1)
			return acb.Response{StatusCode: 200, Kind: acb.HistoryPage, Body: mockHistoryHTML}, nil
		},
	}

	m := New(store, mock, 1*time.Hour)

	// Call RequestSync multiple times concurrently before Run starts
	const n = 10
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := m.RequestSync(ctx); err != nil {
				t.Errorf("RequestSync failed: %v", err)
			}
		}()
	}
	wg.Wait()

	// Start Run and let it process
	go m.Run(ctx)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if callCount.Load() > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Give a little extra time to ensure no second poll was triggered
	time.Sleep(100 * time.Millisecond)

	if callCount.Load() != 1 {
		t.Fatalf("expected 1 coalesced call, got %d", callCount.Load())
	}
}

func TestRequestSyncConcurrentNormalPoll(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "test_sync_concurrent.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if _, err := store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().ExecContext(ctx, "UPDATE connections SET state='MONITORING'"); err != nil {
		t.Fatal(err)
	}

	inNormalPoll := make(chan struct{})
	releaseNormalPoll := make(chan struct{})
	var callCount atomic.Int32

	mock := &countingMockClient{
		getFunc: func(ctx context.Context, endpoint string) (acb.Response, error) {
			idx := callCount.Add(1)
			if idx == 1 {
				// Signal that normal poll is in progress and wait
				close(inNormalPoll)
				select {
				case <-releaseNormalPoll:
				case <-ctx.Done():
				}
			}
			return acb.Response{StatusCode: 200, Kind: acb.HistoryPage, Body: mockHistoryHTML}, nil
		},
	}

	m := New(store, mock, 1*time.Hour)

	// Start normal poll in a goroutine
	normalDone := make(chan error, 1)
	go func() {
		normalDone <- m.PollOnce(ctx)
	}()

	// Wait until normal poll is actively holding the lock and inside client.Get
	select {
	case <-inNormalPoll:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for normal poll to start")
	}

	// Now call RequestSync concurrently. Must not block or deadlock.
	syncDone := make(chan error, 1)
	go func() {
		syncDone <- m.RequestSync(ctx)
	}()

	select {
	case err := <-syncDone:
		if err != nil {
			t.Fatalf("RequestSync failed during active poll: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RequestSync blocked unexpectedly during active normal poll")
	}

	// Start Run to consume the queued sync once normal poll releases
	go m.Run(ctx)

	// Release normal poll
	close(releaseNormalPoll)

	select {
	case err := <-normalDone:
		if err != nil {
			t.Fatalf("normal poll failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for normal poll to finish")
	}

	// Wait for the queued sync poll to also execute
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if callCount.Load() == 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if callCount.Load() != 2 {
		t.Fatalf("expected 2 total calls (normal + queued sync), got %d", callCount.Load())
	}
}
