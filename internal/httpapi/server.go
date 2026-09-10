package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/thedemontuan/tuan-bank-gateway/internal/auth"
	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
	"github.com/thedemontuan/tuan-bank-gateway/internal/httpui"
	"github.com/thedemontuan/tuan-bank-gateway/internal/security"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

type Server struct {
	cfg     config.Config
	store   *storage.Store
	auth    *auth.Middleware
	started time.Time
	handler http.Handler
}

func New(cfg config.Config, store *storage.Store) *Server {
	var verifier auth.Verifier
	if cfg.Production {
		verifier = auth.NewCloudflareVerifier(cfg)
	}
	s := &Server{cfg: cfg, store: store, auth: auth.New(cfg, verifier), started: time.Now().UTC()}
	r := chi.NewRouter()
	r.Use(requestID, securityHeaders, recoverer)
	r.Get("/healthz", s.health)
	r.Get("/health", s.health)
	r.Get("/readyz", s.ready)
	r.Get("/ready", s.ready)
	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/status", s.status)
		api.Get("/csrf", auth.CSRF)
		api.With(s.auth.Require(auth.Owner, auth.Operator, auth.Viewer)).Get("/connection", s.connection)
		api.With(s.auth.Require(auth.Owner, auth.Operator, auth.Viewer)).Get("/webhooks", s.endpoints)
		api.With(s.auth.Require(auth.Owner, auth.Operator, auth.Viewer)).Get("/transactions", s.transactions)
		api.With(s.auth.Require(auth.Owner, auth.Operator, auth.Viewer)).Get("/deliveries", s.deliveries)
		api.With(s.auth.Require(auth.Owner, auth.Operator, auth.Viewer)).Get("/poll-runs", s.pollRuns)
		api.With(s.auth.Require(auth.Owner, auth.Operator, auth.Viewer)).Get("/audit", s.auditLogs)

		api.With(s.auth.Require(auth.Owner)).Post("/connection/configure", s.configure)
		api.With(s.auth.Require(auth.Owner, auth.Operator)).Post("/connection/{action:pause|resume|sync}", s.connectionAction)
		api.With(s.auth.Require(auth.Owner)).Post("/connection/auth/start", s.startAuth)
		api.With(s.auth.Require(auth.Owner)).Post("/connection/auth/cancel", s.cancelAuth)

		api.With(s.auth.Require(auth.Owner)).Post("/webhooks", s.createEndpoint)
		api.With(s.auth.Require(auth.Owner)).Post("/webhooks/{id}/{action:enable|disable}", s.endpointAction)
	})
	ui, err := fs.Sub(httpui.Files, "dist")
	if err == nil {
		r.Mount("/", spa(ui))
	}
	s.handler = r
	return s
}
func (s *Server) Handler() http.Handler { return s.handler }
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Health(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	connection, err := s.store.Connection(r.Context())
	acb := map[string]any{"state": "UNCONFIGURED", "coverage": "NOT_STARTED", "lastSuccessfulPollAt": nil}
	if err == nil {
		acb["state"] = connection.State
		acb["accountMasked"] = connection.AccountMasked
		acb["generation"] = connection.Generation
		acb["coverage"] = "PENDING_ACB_POC"
	} else if !errors.Is(err, storage.ErrNotFound) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "storage_error"})
		return
	}
	summary, err := s.store.DeliverySummary(r.Context())
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "storage_error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"service": "HEALTHY", "version": "2.0.0-dev", "uptimeSeconds": int(time.Since(s.started).Seconds()), "acb": acb, "storage": map[string]string{"status": "READY"}, "webhooks": summary})
}
func (s *Server) connection(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.Connection(r.Context())
	if errors.Is(err, storage.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"configured": false})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"configured": true, "connection": c})
}
func (s *Server) configure(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AccountMasked string `json:"accountMasked"`
	}
	if !decode(w, r, &in) {
		return
	}
	c, err := s.store.ConfigureConnection(r.Context(), in.AccountMasked)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	audit(s.store, r, "connection.configure", c.ID)
	writeJSON(w, http.StatusCreated, c)
}
func (s *Server) connectionAction(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.TransitionConnection(r.Context(), chi.URLParam(r, "action"))
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, "connection_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	audit(s.store, r, "connection."+chi.URLParam(r, "action"), c.ID)
	writeJSON(w, http.StatusAccepted, c)
}
func (s *Server) startAuth(w http.ResponseWriter, r *http.Request) {
	identity, _ := auth.FromContext(r.Context())
	attempt, err := s.store.StartAuthAttempt(r.Context(), identity.Subject, 15*time.Minute)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	audit(s.store, r, "auth.start", attempt.ID)
	writeJSON(w, http.StatusCreated, attempt)
}
func (s *Server) cancelAuth(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AttemptID string `json:"attemptId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.AttemptID == "" {
		writeError(w, http.StatusBadRequest, "attemptId is required")
		return
	}
	err := s.store.FinishAuthAttempt(r.Context(), in.AttemptID, "CANCELLED")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	audit(s.store, r, "auth.cancel", in.AttemptID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "CANCELLED"})
}
func (s *Server) transactions(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListTransactions(r.Context(), 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
func (s *Server) deliveries(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListDeliveries(r.Context(), 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
func (s *Server) pollRuns(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListPollRuns(r.Context(), 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
func (s *Server) auditLogs(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListAuditLogs(r.Context(), 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
func (s *Server) endpoints(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.Endpoints(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
func (s *Server) createEndpoint(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	if !decode(w, r, &in) {
		return
	}
	if _, err := security.ValidateWebhookURL(in.URL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	e, err := s.store.CreateEndpointWithSecret(r.Context(), in.Name, in.URL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	audit(s.store, r, "webhook.create", e.ID)
	writeJSON(w, http.StatusCreated, e)
}
func (s *Server) endpointAction(w http.ResponseWriter, r *http.Request) {
	status := "ACTIVE"
	if chi.URLParam(r, "action") == "disable" {
		status = "DISABLED"
	}
	err := s.store.SetEndpointStatus(r.Context(), chi.URLParam(r, "id"), status)
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, "endpoint_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	audit(s.store, r, "webhook."+strings.ToLower(status), chi.URLParam(r, "id"))
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}
func audit(store *storage.Store, r *http.Request, action, target string) {
	identity, _ := auth.FromContext(r.Context())
	_ = store.Audit(r.Context(), identity.Subject, string(identity.Role), action, target, requestIDFromContext(r.Context()))
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "content_type_must_be_json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	return true
}
func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 12)
		_, _ = rand.Read(b)
		id := hex.EncodeToString(b)
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

type requestIDKey struct{}

func requestIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(requestIDKey{}).(string)
	return v
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; connect-src 'self'")
		if r.TLS != nil {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}
func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recover() != nil {
				writeError(w, http.StatusInternalServerError, "internal_error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}
func spa(files fs.FS) http.Handler {
	static := http.FileServer(http.FS(files))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}
		requested := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if requested != "." && requested != "" {
			if f, err := files.Open(requested); err == nil {
				_ = f.Close()
				static.ServeHTTP(w, r)
				return
			}
		}
		r.URL.Path = "/"
		static.ServeHTTP(w, r)
	})
}
