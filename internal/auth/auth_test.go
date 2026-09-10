package auth

import (
	"context"

	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDevelopmentRolesAndCSRF(t *testing.T) {
	m := New(config.Config{DevelopmentSubject: "alice"}, nil)
	protected := m.Require(Owner)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	get := httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/x", nil)
	rec := httptest.NewRecorder()
	protected.ServeHTTP(rec, get)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("get %d", rec.Code)
	}
	csrfReq := httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/csrf", nil)
	csrfRec := httptest.NewRecorder()
	CSRF(csrfRec, csrfReq)
	cookie := csrfRec.Result().Cookies()[0]
	post := httptest.NewRequest(http.MethodPost, "http://example.test/api/v1/x", nil)
	post.Header.Set("Origin", "http://example.test")
	post.Header.Set("X-CSRF-Token", cookie.Value)
	post.AddCookie(cookie)
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, post)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("post %d", rec.Code)
	}
}

type identityVerifier struct{ identity Identity }

func (v identityVerifier) Verify(context.Context, string) (Identity, error) { return v.identity, nil }

func TestProductionAllowsVerifiedCloudflareEmail(t *testing.T) {
	m := New(config.Config{Production: true, Roles: config.RoleSubjects{Owners: map[string]struct{}{"owner@example.com": {}}}}, identityVerifier{identity: Identity{Subject: "cloudflare-uuid", Email: "owner@example.com"}})
	h := m.Require(Owner)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	r := httptest.NewRequest(http.MethodGet, "https://example.test/api/v1/x", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestDevelopmentRejectsBadCSRF(t *testing.T) {
	m := New(config.Config{DevelopmentSubject: "alice"}, nil)
	h := m.Require(Owner)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	r := httptest.NewRequest(http.MethodPost, "http://example.test/api/v1/x", nil)
	r.Header.Set("Origin", "http://example.test")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("%d", rec.Code)
	}
}
