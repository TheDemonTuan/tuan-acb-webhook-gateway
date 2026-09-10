package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
)

type Role string

const (
	Owner    Role = "OWNER"
	Operator Role = "OPERATOR"
	Viewer   Role = "VIEWER"
)

type Identity struct {
	Subject string `json:"subject"`
	Role    Role   `json:"role"`
}
type contextKey struct{}

func FromContext(ctx context.Context) (Identity, bool) {
	v, ok := ctx.Value(contextKey{}).(Identity)
	return v, ok
}

type Verifier interface {
	Verify(context.Context, string) (string, error)
}
type DevelopmentVerifier struct{ Subject string }

func (v DevelopmentVerifier) Verify(_ context.Context, _ string) (string, error) {
	return v.Subject, nil
}

type Middleware struct {
	cfg      config.Config
	verifier Verifier
}

func New(cfg config.Config, verifier Verifier) *Middleware {
	if verifier == nil && !cfg.Production {
		verifier = DevelopmentVerifier{Subject: cfg.DevelopmentSubject}
	}
	return &Middleware{cfg: cfg, verifier: verifier}
}
func (m *Middleware) Require(roles ...Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, err := m.identity(r)
			if err != nil {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			if !allows(identity.Role, roles) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
				if !sameOrigin(r) || !csrfValid(r) {
					http.Error(w, "csrf validation failed", http.StatusForbidden)
					return
				}
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, identity)))
		})
	}
}
func (m *Middleware) identity(r *http.Request) (Identity, error) {
	if m.verifier == nil {
		return Identity{}, errors.New("authentication verifier unavailable")
	}
	subject, err := m.verifier.Verify(r.Context(), r.Header.Get("Cf-Access-Jwt-Assertion"))
	if err != nil {
		return Identity{}, err
	}
	role, ok := m.role(subject)
	if !ok {
		return Identity{}, errors.New("subject is not allowed")
	}
	return Identity{Subject: subject, Role: role}, nil
}
func (m *Middleware) role(subject string) (Role, bool) {
	if !m.cfg.Production && subject == m.cfg.DevelopmentSubject {
		return Owner, true
	}
	if _, ok := m.cfg.Roles.Owners[subject]; ok {
		return Owner, true
	}
	if _, ok := m.cfg.Roles.Operators[subject]; ok {
		return Operator, true
	}
	if _, ok := m.cfg.Roles.Viewers[subject]; ok {
		return Viewer, true
	}
	return "", false
}
func allows(actual Role, required []Role) bool {
	for _, role := range required {
		if actual == role {
			return true
		}
	}
	return false
}
func CSRF(w http.ResponseWriter, r *http.Request) {
	token := make([]byte, 32)
	_, _ = rand.Read(token)
	encoded := base64.RawURLEncoding.EncodeToString(token)
	http.SetCookie(w, &http.Cookie{Name: "tbg_csrf", Value: encoded, Path: "/api/v1", Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: 3600})
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"token":"` + encoded + `"}`))
}
func csrfValid(r *http.Request) bool {
	cookie, err := r.Cookie("tbg_csrf")
	if err != nil || cookie.Value == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(r.Header.Get("X-CSRF-Token"))) == 1
}
func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return strings.TrimSuffix(origin, "/") == scheme+"://"+r.Host
}
