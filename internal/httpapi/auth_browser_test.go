package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

func TestAuthBrowserStatusFailures(t *testing.T) {
	for _, tc := range []struct {
		name      string
		upstream  int
		status    string
		wantHTTP  int
		wantState string
	}{
		{"missing browser", 404, "", 200, "AUTH_REQUIRED"},
		{"failed browser", 200, "FAILED", 200, "AUTH_REQUIRED"},
		{"expired browser", 200, "EXPIRED", 200, "AUTH_REQUIRED"},
		{"temporary upstream failure", 503, "", 502, "AUTH_STARTING"},
		{"verified without keyring", 200, "VERIFIED", 503, "AUTH_STARTING"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			if _, err = store.ConfigureConnection(ctx, "***1234"); err != nil {
				t.Fatal(err)
			}
			attempt, err := store.StartAuthAttempt(ctx, "", time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			handoffs := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost {
					handoffs++
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.upstream)
				_ = json.NewEncoder(w).Encode(map[string]string{"attemptId": attempt.ID, "status": tc.status})
			}))
			defer upstream.Close()
			server := New(config.Config{Timezone: time.UTC, DevelopmentSubject: "owner", AuthBrowserURL: upstream.URL}, store)
			w := httptest.NewRecorder()
			server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+attempt.ID+"/status", nil))
			if w.Code != tc.wantHTTP {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			connection, err := store.Connection(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if connection.State != tc.wantState {
				t.Fatalf("connection state %s, want %s", connection.State, tc.wantState)
			}
			if handoffs != 0 {
				t.Fatal("consumed one-time handoff without an encryption key")
			}
			if tc.wantState == "AUTH_REQUIRED" {
				if _, err = store.StartAuthAttempt(ctx, "", time.Minute); err != nil {
					t.Fatalf("cannot retry after terminal browser failure: %v", err)
				}
			}
		})
	}
}
