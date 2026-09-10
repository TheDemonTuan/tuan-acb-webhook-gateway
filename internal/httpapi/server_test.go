package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

func TestHealthStatusAndSPARouting(t *testing.T) {
	t.Parallel()
	store, err := storage.Open(context.Background(), filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := New(config.Config{Timezone: time.UTC}, store).Handler()
	for _, tc := range []struct {
		path        string
		code        int
		contentType string
	}{{"/healthz", http.StatusOK, "application/json"}, {"/readyz", http.StatusOK, "application/json"}, {"/api/v1/status", http.StatusOK, "application/json"}, {"/transactions", http.StatusOK, "text/html"}, {"/api/v1/missing", http.StatusNotFound, "text/plain"}} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rec := httptest.NewRecorder()
		server.ServeHTTP(rec, req)
		if rec.Code != tc.code {
			t.Fatalf("%s: code=%d, want %d", tc.path, rec.Code, tc.code)
		}
		if got := rec.Header().Get("Content-Type"); len(got) < len(tc.contentType) || got[:len(tc.contentType)] != tc.contentType {
			t.Fatalf("%s: Content-Type=%q", tc.path, got)
		}
		if rec.Header().Get("X-Request-Id") == "" {
			t.Fatalf("%s missing request ID", tc.path)
		}
	}
}
