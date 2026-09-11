package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
	"github.com/thedemontuan/tuan-bank-gateway/internal/monitor"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

type syncRecorder struct {
	calls int
	err   error
}

func (s *syncRecorder) RequestSync(context.Context) error { s.calls++; return s.err }

func TestSyncPreservesConnectionAndAuth(t *testing.T) {
	for _, state := range []string{"AUTH_REQUIRED", "AUTH_STARTING", "PAUSED", "MONITORING"} {
		t.Run(state, func(t *testing.T) {
			ctx := context.Background()
			store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			if _, err := store.ConfigureConnection(ctx, "***1234"); err != nil {
				t.Fatal(err)
			}
			attempt, err := store.StartAuthAttempt(ctx, "", time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := store.DB().ExecContext(ctx, "UPDATE connections SET state=?", state); err != nil {
				t.Fatal(err)
			}
			before, _ := store.Connection(ctx)
			recorder := &syncRecorder{}
			server := New(config.Config{Timezone: time.UTC}, store).WithSyncRequester(recorder)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/connection/sync", nil)
			route := chi.NewRouteContext()
			route.URLParams.Add("action", "sync")
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, route))
			w := httptest.NewRecorder()
			server.connectionAction(w, req)
			want := http.StatusConflict
			calls := 0
			if state == "MONITORING" {
				want = http.StatusAccepted
				calls = 1
			}
			if w.Code != want || recorder.calls != calls {
				t.Fatalf("response=%d %s calls=%d", w.Code, w.Body.String(), recorder.calls)
			}
			after, _ := store.Connection(ctx)
			if after != before {
				t.Fatalf("sync mutated connection: before=%+v after=%+v", before, after)
			}
			current, err := store.AuthAttemptStatusForOwner(ctx, attempt.ID, "")
			if err != nil || current.Status != attempt.Status {
				t.Fatalf("attempt=%+v err=%v", current, err)
			}
		})
	}
}

func TestSyncRejectsChangedState(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
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
	server := New(config.Config{Timezone: time.UTC}, store).WithSyncRequester(&syncRecorder{err: monitor.ErrSyncUnavailable})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/connection/sync", nil)
	route := chi.NewRouteContext()
	route.URLParams.Add("action", "sync")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, route))
	w := httptest.NewRecorder()
	server.connectionAction(w, req)
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != http.StatusConflict || body["code"] != "SYNC_UNAVAILABLE" {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
