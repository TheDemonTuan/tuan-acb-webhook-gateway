package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
	"github.com/thedemontuan/tuan-bank-gateway/internal/authbrowser"
)

const acbLoginURL = "https://online.acb.com.vn/acbib/Request"

type browserSession struct {
	AttemptID string    `json:"attemptId"`
	Status    string    `json:"status"`
	ScreenURL string    `json:"screenUrl"`
	ExpiresAt time.Time `json:"expiresAt"`
	cancel    context.CancelFunc
	debugURL  string
	handoff   string
	verified  bool
}

type server struct {
	mu       sync.Mutex
	session  *browserSession
	profiles string
}

func main() {
	ctx, cancel := signalContext()
	defer cancel()
	controller := &server{profiles: "/tmp/acb-browser"}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /sessions", controller.start)
	mux.HandleFunc("DELETE /sessions/{attemptID}", controller.cancel)
	mux.HandleFunc("GET /sessions/{attemptID}/status", controller.status)
	mux.HandleFunc("POST /sessions/{attemptID}/handoff", controller.handoff)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })

	httpServer := &http.Server{Addr: ":8181", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		_ = httpServer.Shutdown(context.Background())
		controller.stopCurrent()
	}()
	slog.Info("ACB browser controller listening", "address", ":8181")
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("ACB browser controller failed", "error", err)
		os.Exit(1)
	}
}

func (s *server) start(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AttemptID string `json:"attemptId"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil || strings.TrimSpace(input.AttemptID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "attemptId is required"})
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "an ACB browser session is already active"})
		return
	}
	if err := os.MkdirAll(s.profiles, 0o700); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cannot prepare browser profile"})
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	item := &browserSession{AttemptID: input.AttemptID, Status: "AWAITING_USER_LOGIN", ScreenURL: "/", ExpiresAt: time.Now().UTC().Add(15 * time.Minute), cancel: cancel, debugURL: "http://127.0.0.1:9222"}
	s.session = item
	go s.launch(ctx, item)
	writeJSON(w, http.StatusCreated, item)
}

func (s *server) launch(ctx context.Context, item *browserSession) {
	profile := filepath.Join(s.profiles, item.AttemptID)
	if err := os.MkdirAll(profile, 0o700); err != nil {
		slog.Warn("prepare ACB browser profile", "error", err)
		s.clear(item.AttemptID)
		return
	}
	// CDP has no listening address; Chromium is only controlled by the owner
	// through noVNC on the private Docker network.
	cmd := exec.CommandContext(ctx, "chromium", "--user-data-dir="+profile, "--no-first-run", "--disable-default-apps", "--disable-sync", "--disable-extensions", "--disable-background-networking", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9222", acbLoginURL)
	cmd.Env = append(os.Environ(), "DISPLAY=:99", "HOME=/tmp")
	if err := cmd.Start(); err != nil {
		slog.Warn("launch ACB Chromium", "error", err)
		s.clear(item.AttemptID)
		return
	}
	go s.observeLogin(ctx, item.AttemptID, item.debugURL)
	_ = cmd.Wait()
	_ = os.RemoveAll(profile)
	s.clear(item.AttemptID)
}

func (s *server) cancel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("attemptID")
	s.mu.Lock()
	if s.session == nil || s.session.AttemptID != id {
		s.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.session.cancel()
	s.session = nil
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) status(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("attemptID")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session == nil || s.session.AttemptID != id {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}
	writeJSON(w, http.StatusOK, s.session)
}

func (s *server) handoff(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("attemptID")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session == nil || s.session.AttemptID != id || !s.session.verified || s.session.handoff == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "ACB login has not been verified"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"session": s.session.handoff})
	s.session.handoff = ""
}

func (s *server) observeLogin(ctx context.Context, id, debugURL string) {
	deadline := time.NewTimer(15 * time.Minute)
	defer deadline.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-deadline.C:
			return
		case <-time.After(2 * time.Second):
		}
		allocatorCtx, cancel := chromedp.NewRemoteAllocator(ctx, debugURL)
		browserCtx, browserCancel := chromedp.NewContext(allocatorCtx)
		var currentURL string
		var cookies []*network.Cookie
		var targets []*target.Info
		err := chromedp.Run(browserCtx, chromedp.ActionFunc(func(runCtx context.Context) error {
			var targetErr error
			targets, targetErr = target.GetTargets().Do(runCtx)
			return targetErr
		}))
		if err == nil {
			for _, info := range targets {
				if info.Type != "page" || !strings.Contains(strings.ToLower(info.URL), "online.acb.com.vn") {
					continue
				}
				pageCtx, pageCancel := chromedp.NewContext(browserCtx, chromedp.WithTargetID(info.TargetID))
				err = chromedp.Run(pageCtx, chromedp.Location(&currentURL), chromedp.ActionFunc(func(runCtx context.Context) error {
					var cookieErr error
					cookies, cookieErr = network.GetCookies().WithURLs([]string{currentURL}).Do(runCtx)
					return cookieErr
				}))
				pageCancel()
				if err == nil {
					break
				}
			}
		}
		browserCancel()
		cancel()
		if err != nil || !authenticatedACB(currentURL, cookies) {
			continue
		}
		serializable := make([]authbrowser.Cookie, 0, len(cookies))
		for _, cookie := range cookies {
			serializable = append(serializable, authbrowser.Cookie{Name: cookie.Name, Value: cookie.Value, Domain: cookie.Domain, Path: cookie.Path, Expires: time.Unix(int64(cookie.Expires), 0).UTC(), Secure: cookie.Secure, HTTPOnly: cookie.HTTPOnly})
		}
		serialized, err := json.Marshal(serializable)
		if err != nil {
			return
		}
		handoffBytes := make([]byte, 32)
		if _, err := rand.Read(handoffBytes); err != nil {
			return
		}
		code := base64.RawURLEncoding.EncodeToString(handoffBytes)
		s.mu.Lock()
		if s.session != nil && s.session.AttemptID == id {
			s.session.Status = "VERIFIED"
			s.session.handoff = base64.RawURLEncoding.EncodeToString(serialized) + "." + code
			s.session.verified = true
		}
		s.mu.Unlock()
		return
	}
}

func authenticatedACB(location string, cookies []*network.Cookie) bool {
	if !strings.Contains(strings.ToLower(location), "online.acb.com.vn") || strings.Contains(strings.ToLower(location), "obkloginop") || strings.Contains(strings.ToLower(location), "login") {
		return false
	}
	for _, cookie := range cookies {
		if strings.Contains(strings.ToLower(cookie.Domain), "acb.com.vn") && cookie.Value != "" {
			return true
		}
	}
	return false
}

func (s *server) stopCurrent() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session != nil {
		s.session.cancel()
		s.session = nil
	}
}

func (s *server) clear(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session != nil && s.session.AttemptID == id {
		s.session = nil
	}
}

func signalContext() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan os.Signal, 1)
	signalNotify(ch)
	go func() { <-ch; cancel() }()
	return ctx, cancel
}

func signalNotify(ch chan<- os.Signal) { signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM) }

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		fmt.Fprint(w, "")
	}
}
