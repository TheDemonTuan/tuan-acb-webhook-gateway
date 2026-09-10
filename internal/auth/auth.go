package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
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
	Email   string `json:"email,omitempty"`
	Subject string `json:"subject"`
	Role    Role   `json:"role"`
}
type contextKey struct{}

func FromContext(ctx context.Context) (Identity, bool) {
	v, ok := ctx.Value(contextKey{}).(Identity)
	return v, ok
}

type Verifier interface {
	Verify(context.Context, string) (Identity, error)
}
type DevelopmentVerifier struct{ Subject string }

func (v DevelopmentVerifier) Verify(_ context.Context, _ string) (Identity, error) {
	return Identity{Subject: v.Subject}, nil
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
				slog.Warn("auth rejected", "method", r.Method, "path", r.URL.Path, "error", err)
				writeAuthError(w, http.StatusUnauthorized, "unauthorized: "+err.Error())
				return
			}
			if !allows(identity.Role, roles) {
				slog.Warn("role rejected", "method", r.Method, "path", r.URL.Path, "role", identity.Role, "required", roles)
				writeAuthError(w, http.StatusForbidden, fmt.Sprintf("forbidden: role %s not permitted", identity.Role))
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
				if !sameOrigin(r) || !csrfValid(r) {
					slog.Warn("csrf rejected", "method", r.Method, "path", r.URL.Path)
					writeAuthError(w, http.StatusForbidden, "csrf validation failed")
					return
				}
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, identity)))
		})
	}
}

func extractToken(r *http.Request) string {
	if h := strings.TrimSpace(r.Header.Get("Cf-Access-Jwt-Assertion")); h != "" {
		return h
	}
	if c, err := r.Cookie("CF_Authorization"); err == nil && strings.TrimSpace(c.Value) != "" {
		return strings.TrimSpace(c.Value)
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return ""
}

func writeAuthError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func (m *Middleware) identity(r *http.Request) (Identity, error) {
	if m.verifier == nil {
		return Identity{}, errors.New("authentication verifier unavailable")
	}
	token := extractToken(r)
	identity, err := m.verifier.Verify(r.Context(), token)
	if err != nil {
		return Identity{}, err
	}
	if m.cfg.Production {
		if identity.Email == "" {
			return Identity{}, errors.New("verified Cloudflare Access JWT is missing email")
		}
		role, ok := m.role(identity.Email)
		if !ok {
			return Identity{}, errors.New("email is not authorized")
		}
		identity.Role = role
		return identity, nil
	}
	role, ok := m.role(identity.Subject)
	if !ok {
		return Identity{}, errors.New("subject is not allowed")
	}
	identity.Role = role
	return identity, nil
}
func (m *Middleware) role(subject string) (Role, bool) {
	if !m.cfg.Production && subject == m.cfg.DevelopmentSubject {
		return Owner, true
	}
	subLower := strings.ToLower(subject)
	for s := range m.cfg.Roles.Owners {
		if s == subject || strings.ToLower(s) == subLower {
			return Owner, true
		}
	}
	for s := range m.cfg.Roles.Operators {
		if s == subject || strings.ToLower(s) == subLower {
			return Operator, true
		}
	}
	for s := range m.cfg.Roles.Viewers {
		if s == subject || strings.ToLower(s) == subLower {
			return Viewer, true
		}
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
	http.SetCookie(w, &http.Cookie{Name: "tbg_csrf", Value: encoded, Path: "/api/v1", Secure: publicOrigin(r).Scheme == "https", SameSite: http.SameSiteStrictMode, MaxAge: 3600})
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
	return strings.TrimSuffix(origin, "/") == publicOrigin(r).String()
}

// publicOrigin is configured at deployment because Cloudflare terminates TLS
// before proxying plain HTTP to the gateway.
func publicOrigin(r *http.Request) *url.URL {
	if configured := strings.TrimSpace(os.Getenv("PUBLIC_ORIGIN")); configured != "" {
		if parsed, err := url.Parse(configured); err == nil && parsed.Scheme != "" && parsed.Host != "" {
			return &url.URL{Scheme: parsed.Scheme, Host: parsed.Host}
		}
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return &url.URL{Scheme: scheme, Host: r.Host}
}
