package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestAdminLifecycle(t *testing.T) {
	store, err := storage.Open(context.Background(), filepath.Join(t.TempDir(), "x.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	h := New(config.Config{Timezone: time.UTC, DevelopmentSubject: "owner"}, store).Handler()
	csrfReq := httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/csrf", nil)
	csrfRec := httptest.NewRecorder()
	h.ServeHTTP(csrfRec, csrfReq)
	cookie := csrfRec.Result().Cookies()[0]
	var token struct{ Token string }
	_ = json.NewDecoder(csrfRec.Result().Body).Decode(&token)
	post := func(path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "http://example.test"+path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://example.test")
		r.Header.Set("X-CSRF-Token", token.Token)
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := post("/api/v1/connection/configure", `{"accountMasked":"***1234"}`); w.Code != http.StatusCreated {
		t.Fatalf("configure %d %s", w.Code, w.Body.String())
	}
	if w := post("/api/v1/webhooks", `{"name":"receiver","url":"https://events.example.com/bank"}`); w.Code != http.StatusCreated {
		t.Fatalf("endpoint %d %s", w.Code, w.Body.String())
	}
	r := httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/webhooks", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("get endpoints %d", w.Code)
	}
}
