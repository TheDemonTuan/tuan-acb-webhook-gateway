package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
		{"cancelled browser", 200, "CANCELLED", 200, "AUTH_REQUIRED"},
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

func TestAuthBrowserStatusTerminalIdempotence(t *testing.T) {
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

	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	keyPath := filepath.Join(t.TempDir(), "master.key")
	if err := os.WriteFile(keyPath, []byte(base64.RawStdEncoding.EncodeToString(key)), 0o600); err != nil {
		t.Fatal(err)
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/handoff") {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"session": "handoff-secret-data"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"attemptId": attempt.ID, "status": "VERIFIED"})
	}))
	defer upstream.Close()

	server := New(config.Config{
		Timezone:           time.UTC,
		DevelopmentSubject: "owner",
		AuthBrowserURL:     upstream.URL,
		MasterKeyFile:      keyPath,
	}, store)

	// First poll transitions to MONITORING
	w1 := httptest.NewRecorder()
	server.Handler().ServeHTTP(w1, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+attempt.ID+"/status", nil))
	if w1.Code != http.StatusOK {
		t.Fatalf("first poll status %d: %s", w1.Code, w1.Body.String())
	}
	var res1 map[string]string
	_ = json.Unmarshal(w1.Body.Bytes(), &res1)
	if res1["status"] != "MONITORING" {
		t.Fatalf("first poll status=%v, want MONITORING", res1["status"])
	}

	// Subsequent poll returns MONITORING idempotently (NOT 404!)
	w2 := httptest.NewRecorder()
	server.Handler().ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+attempt.ID+"/status", nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("second poll status %d: %s", w2.Code, w2.Body.String())
	}
	var res2 map[string]string
	_ = json.Unmarshal(w2.Body.Bytes(), &res2)
	if res2["status"] != "MONITORING" {
		t.Fatalf("second poll status=%v, want MONITORING", res2["status"])
	}

	// VNC screen access must be rejected after terminal status
	wScreen := httptest.NewRecorder()
	server.Handler().ServeHTTP(wScreen, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+attempt.ID+"/screen/vnc.html", nil))
	if wScreen.Code != http.StatusNotFound {
		t.Fatalf("VNC screen allowed after terminal: got %d", wScreen.Code)
	}
}

func TestAuthBrowserStatusTTLExpiryLifecycle(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err = store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}

	// Start attempt with very short TTL
	attempt, err := store.StartAuthAttempt(ctx, "", 20*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(35 * time.Millisecond)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"attemptId": attempt.ID, "status": "IN_PROGRESS"})
	}))
	defer upstream.Close()

	server := New(config.Config{
		Timezone:           time.UTC,
		DevelopmentSubject: "owner",
		AuthBrowserURL:     upstream.URL,
	}, store)

	// First poll detects expiry
	w1 := httptest.NewRecorder()
	server.Handler().ServeHTTP(w1, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+attempt.ID+"/status", nil))
	if w1.Code != http.StatusOK {
		t.Fatalf("expiry poll status %d: %s", w1.Code, w1.Body.String())
	}
	var res1 map[string]string
	_ = json.Unmarshal(w1.Body.Bytes(), &res1)
	if res1["status"] != "EXPIRED" || !strings.Contains(res1["error"], "Phiên đăng nhập ACB đã hết hạn") {
		t.Fatalf("expected EXPIRED status and message, got %+v", res1)
	}

	conn, err := store.Connection(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if conn.State != "AUTH_REQUIRED" {
		t.Fatalf("expected state AUTH_REQUIRED, got %s", conn.State)
	}

	// Subsequent poll must NOT return 404; must return EXPIRED idempotently
	w2 := httptest.NewRecorder()
	server.Handler().ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+attempt.ID+"/status", nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("second expiry poll returned %d (wanted 200, NOT 404): %s", w2.Code, w2.Body.String())
	}
	var res2 map[string]string
	_ = json.Unmarshal(w2.Body.Bytes(), &res2)
	if res2["status"] != "EXPIRED" {
		t.Fatalf("expected second poll status EXPIRED, got %+v", res2)
	}

	// VNC screen access must return 404
	wScreen := httptest.NewRecorder()
	server.Handler().ServeHTTP(wScreen, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+attempt.ID+"/screen/vnc.html", nil))
	if wScreen.Code != http.StatusNotFound {
		t.Fatalf("VNC screen allowed after expiry: got %d", wScreen.Code)
	}
}

func TestAuthBrowserCancelEndpoint(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err = store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}

	cancelShouldFail := true
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			if cancelShouldFail {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"attemptId": "test", "status": "IN_PROGRESS"})
	}))
	defer upstream.Close()

	server := New(config.Config{
		Timezone:           time.UTC,
		DevelopmentSubject: "owner",
		AuthBrowserURL:     upstream.URL,
	}, store)
	h := server.Handler()

	csrfReq := httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/csrf", nil)
	csrfRec := httptest.NewRecorder()
	h.ServeHTTP(csrfRec, csrfReq)
	cookie := csrfRec.Result().Cookies()[0]
	var token struct{ Token string }
	_ = json.NewDecoder(csrfRec.Result().Body).Decode(&token)
	post := func(path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "http://example.test"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://example.test")
		r.Header.Set("X-CSRF-Token", token.Token)
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	// 1. Ownership enforcement: attempt owned by another subject
	otherAttempt, err := store.StartAuthAttempt(ctx, "other_owner@example.com", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	// Dev caller has identity.Email == "" which does not match "other_owner@example.com"
	wWrongOwner := post("/api/v1/connection/auth/cancel", `{"attemptId":"`+otherAttempt.ID+`"}`)
	if wWrongOwner.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for wrong owner, got %d: %s", wWrongOwner.Code, wWrongOwner.Body.String())
	}

	// Finish otherAttempt so we can start our own
	if err := store.FinishAuthAttempt(ctx, otherAttempt.ID, "FAILED"); err != nil {
		t.Fatal(err)
	}

	// 2. Upstream cancel failure: must not claim success or finish attempt
	myAttempt, err := store.StartAuthAttempt(ctx, "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	cancelShouldFail = true
	wFail := post("/api/v1/connection/auth/cancel", `{"attemptId":"`+myAttempt.ID+`"}`)
	if wFail.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 Bad Gateway when upstream cancel fails, got %d: %s", wFail.Code, wFail.Body.String())
	}
	// Verify attempt is still active in DB
	activeAttempt, err := store.AuthAttemptStatusForOwner(ctx, myAttempt.ID, "")
	if err != nil || activeAttempt.Status != "STARTING" {
		t.Fatalf("attempt should remain STARTING after failed cancel: %+v, %v", activeAttempt, err)
	}

	// 3. Successful cancel
	cancelShouldFail = false
	wSuccess := post("/api/v1/connection/auth/cancel", `{"attemptId":"`+myAttempt.ID+`"}`)
	if wSuccess.Code != http.StatusOK {
		t.Fatalf("expected 200 for successful cancel, got %d: %s", wSuccess.Code, wSuccess.Body.String())
	}
	cancelledAttempt, err := store.AuthAttemptStatusForOwner(ctx, myAttempt.ID, "")
	if err != nil || cancelledAttempt.Status != "CANCELLED" {
		t.Fatalf("attempt should be CANCELLED: %+v, %v", cancelledAttempt, err)
	}

	// 4. Repeated cancel is idempotent
	wRepeat := post("/api/v1/connection/auth/cancel", `{"attemptId":"`+myAttempt.ID+`"}`)
	if wRepeat.Code != http.StatusOK {
		t.Fatalf("expected 200 for idempotent cancel, got %d: %s", wRepeat.Code, wRepeat.Body.String())
	}

	// 5. Status poll on cancelled attempt returns CANCELLED (not 404)
	wStatus := httptest.NewRecorder()
	h.ServeHTTP(wStatus, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+myAttempt.ID+"/status", nil))
	if wStatus.Code != http.StatusOK {
		t.Fatalf("expected 200 for status of cancelled attempt, got %d: %s", wStatus.Code, wStatus.Body.String())
	}
	var res map[string]string
	_ = json.Unmarshal(wStatus.Body.Bytes(), &res)
	if res["status"] != "CANCELLED" {
		t.Fatalf("expected status CANCELLED, got %+v", res)
	}

	// 6. VNC screen access returns 404
	wScreen := httptest.NewRecorder()
	h.ServeHTTP(wScreen, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+myAttempt.ID+"/screen/vnc.html", nil))
	if wScreen.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for VNC screen of cancelled attempt, got %d", wScreen.Code)
	}
}

func TestAuthBrowserStaleResponseSuperseded(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err = store.ConfigureConnection(ctx, "***1234"); err != nil {
		t.Fatal(err)
	}

	attempt1, err := store.StartAuthAttempt(ctx, "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"attemptId": attempt1.ID, "status": "VERIFIED"})
	}))
	defer upstream.Close()

	server := New(config.Config{
		Timezone:           time.UTC,
		DevelopmentSubject: "owner",
		AuthBrowserURL:     upstream.URL,
	}, store)

	// Transition connection to pause (bumps connection generation from 2 to 3)
	pausedConn, err := store.TransitionConnection(ctx, "pause")
	if err != nil {
		t.Fatal(err)
	}
	if pausedConn.Generation <= attempt1.Generation {
		t.Fatalf("expected paused generation > attempt1.Generation: %d <= %d", pausedConn.Generation, attempt1.Generation)
	}

	// Check status for attempt 1 (generation 2) when connection is now generation 3
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/connection/auth/"+attempt1.ID+"/status", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for superseded attempt, got %d: %s", w.Code, w.Body.String())
	}

	// Verify connection generation and state was NOT corrupted/reverted
	connAfter, err := store.Connection(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if connAfter.Generation != pausedConn.Generation || connAfter.State != "PAUSED" {
		t.Fatalf("connection corrupted by stale response: %+v", connAfter)
	}
}
