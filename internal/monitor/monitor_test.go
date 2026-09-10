package monitor

import (
	"context"
	"path/filepath"
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
