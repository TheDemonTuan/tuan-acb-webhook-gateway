package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
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

const (
	acbLoginURL  = "https://online.acb.com.vn/acbib/Request"
	sessionTTL   = 15 * time.Minute
	startupLimit = 10 * time.Second
)

type browserSession struct {
	AttemptID string    `json:"attemptId"`
	Status    string    `json:"status"`
	ScreenURL string    `json:"screenUrl"`
	ExpiresAt time.Time `json:"expiresAt"`
	Error     string    `json:"error,omitempty"`
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
	if len(os.Args) == 2 && os.Args[1] == "--healthcheck" {
		if err := controllerHealth(); err != nil {
			slog.Error("ACB browser healthcheck failed", "error", err)
			os.Exit(1)
		}
		return
	}

	ctx, cancel := signalContext()
	defer cancel()
	controller := &server{profiles: "/tmp/acb-browser"}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /sessions", controller.start)
	mux.HandleFunc("DELETE /sessions/{attemptID}", controller.cancel)
	mux.HandleFunc("GET /sessions/{attemptID}/status", controller.status)
	mux.HandleFunc("POST /sessions/{attemptID}/handoff", controller.handoff)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		if err := desktopHealth(); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

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
	if s.session != nil && terminalStatus(s.session.Status) {
		s.session.cancel()
		s.session = nil
	}
	if s.session != nil {
		s.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "an ACB browser session is already active"})
		return
	}
	if err := os.MkdirAll(s.profiles, 0o700); err != nil {
		s.mu.Unlock()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cannot prepare browser profile"})
		return
	}

	expiresAt := time.Now().UTC().Add(sessionTTL)
	ctx, cancel := context.WithDeadline(context.Background(), expiresAt)
	item := &browserSession{AttemptID: input.AttemptID, Status: "STARTING", ScreenURL: "/", ExpiresAt: expiresAt, cancel: cancel, debugURL: "http://127.0.0.1:9222"}
	s.session = item
	s.mu.Unlock()

	ready := make(chan error, 1)
	go s.launch(ctx, item, ready)
	select {
	case err := <-ready:
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "ACB browser could not start"})
			return
		}
		s.mu.Lock()
		response := *item
		s.mu.Unlock()
		writeJSON(w, http.StatusCreated, response)
	case <-r.Context().Done():
		cancel()
	case <-time.After(startupLimit + time.Second):
		s.setTerminal(item.AttemptID, "FAILED", "browser startup timed out")
		cancel()
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "ACB browser startup timed out"})
	}
}

func (s *server) launch(ctx context.Context, item *browserSession, ready chan<- error) {
	profile := filepath.Join(s.profiles, item.AttemptID)
	if err := os.MkdirAll(profile, 0o700); err != nil {
		s.failStartup(item, ready, "cannot prepare Chromium profile", err)
		return
	}
	defer os.RemoveAll(profile)

	cmd := exec.CommandContext(ctx, "chromium",
		"--user-data-dir="+profile,
		"--no-first-run",
		"--disable-default-apps",
		"--disable-sync",
		"--disable-extensions",
		"--disable-background-networking",
		"--disable-dev-shm-usage",
		"--disable-setuid-sandbox",
		"--window-size=1280,900",
		"--remote-debugging-address=127.0.0.1",
		"--remote-debugging-port=9222",
		acbLoginURL,
	)
	cmd.Env = append(os.Environ(), "DISPLAY=:99", "HOME=/tmp")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		s.failStartup(item, ready, "Chromium failed to launch", err)
		return
	}

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	startupCtx, startupCancel := context.WithTimeout(ctx, startupLimit)
	err := waitBrowserReady(startupCtx, item.debugURL, exited)
	startupCancel()
	if err != nil {
		item.cancel()
		s.failStartup(item, ready, "Chromium did not become ready", err)
		return
	}

	s.mu.Lock()
	if s.session == item {
		item.Status = "AWAITING_USER_LOGIN"
		item.Error = ""
	}
	s.mu.Unlock()
	ready <- nil
	go s.observeLogin(ctx, item.AttemptID, item.debugURL)

	err = <-exited
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session != item || terminalStatus(item.Status) || item.Status == "VERIFIED" {
		return
	}
	if time.Now().UTC().After(item.ExpiresAt) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		item.Status = "EXPIRED"
		item.Error = "ACB login session expired"
		slog.Info("ACB Chromium session expired", "attempt_id", item.AttemptID)
		return
	}
	item.Status = "FAILED"
	item.Error = "Chromium exited before login completed"
	slog.Warn("ACB Chromium exited", "attempt_id", item.AttemptID, "error", err)
}

func (s *server) failStartup(item *browserSession, ready chan<- error, message string, err error) {
	s.setTerminal(item.AttemptID, "FAILED", message)
	slog.Warn(message, "attempt_id", item.AttemptID, "error", err)
	ready <- err
}

func (s *server) setTerminal(id, status, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session != nil && s.session.AttemptID == id {
		s.session.Status = status
		s.session.Error = message
	}
}

func (s *server) cancel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("attemptID")
	s.mu.Lock()
	if s.session == nil || s.session.AttemptID != id {
		s.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.session.Status = "CANCELLED"
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
	if time.Now().UTC().After(s.session.ExpiresAt) && !terminalStatus(s.session.Status) {
		s.session.Status = "EXPIRED"
		s.session.Error = "ACB login session expired"
		s.session.cancel()
	}
	writeJSON(w, http.StatusOK, s.session)
}

func (s *server) handoff(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("attemptID")
	s.mu.Lock()
	if s.session == nil || s.session.AttemptID != id || !s.session.verified || s.session.handoff == "" {
		s.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "ACB login has not been verified"})
		return
	}
	item := s.session
	handoff := item.handoff
	item.handoff = ""
	item.Status = "COMPLETED"
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]string{"session": handoff})
	item.cancel()
}

func (s *server) observeLogin(ctx context.Context, id, debugURL string) {
	for {
		select {
		case <-ctx.Done():
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
		payload, err := json.Marshal(serializable)
		if err != nil {
			continue
		}
		nonce := make([]byte, 24)
		_, _ = rand.Read(nonce)
		s.mu.Lock()
		if s.session != nil && s.session.AttemptID == id && s.session.Status == "AWAITING_USER_LOGIN" {
			s.session.handoff = base64.RawURLEncoding.EncodeToString(nonce) + "." + base64.RawURLEncoding.EncodeToString(payload)
			s.session.verified = true
			s.session.Status = "VERIFIED"
		}
		s.mu.Unlock()
		return
	}
}

func waitBrowserReady(ctx context.Context, debugURL string, exited <-chan error) error {
	client := &http.Client{Timeout: time.Second}
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case err := <-exited:
			if err == nil {
				return errors.New("Chromium exited during startup")
			}
			return fmt.Errorf("Chromium exited during startup: %w", err)
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			request, err := http.NewRequestWithContext(ctx, http.MethodGet, debugURL+"/json/version", nil)
			if err != nil {
				continue
			}
			response, err := client.Do(request)
			if err != nil {
				continue
			}
			var version struct {
				WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
			}
			decodeErr := json.NewDecoder(io.LimitReader(response.Body, 32<<10)).Decode(&version)
			response.Body.Close()
			if response.StatusCode == http.StatusOK && decodeErr == nil && version.WebSocketDebuggerURL != "" {
				return nil
			}
		}
	}
}

func desktopHealth() error {
	if _, err := os.Stat("/tmp/.X11-unix/X99"); err != nil {
		return errors.New("X display is unavailable")
	}
	for _, address := range []string{"127.0.0.1:5900", "127.0.0.1:6080"} {
		connection, err := net.DialTimeout("tcp", address, time.Second)
		if err != nil {
			return fmt.Errorf("desktop service %s is unavailable", address)
		}
		connection.Close()
	}
	return nil
}

func controllerHealth() error {
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://127.0.0.1:8181/healthz")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("controller returned HTTP %d", response.StatusCode)
	}
	return nil
}

func terminalStatus(status string) bool {
	switch status {
	case "FAILED", "EXPIRED", "CANCELLED", "COMPLETED":
		return true
	default:
		return false
	}
}

func authenticatedACB(currentURL string, cookies []*network.Cookie) bool {
	lowerURL := strings.ToLower(currentURL)
	if !strings.Contains(lowerURL, "online.acb.com.vn") || strings.Contains(lowerURL, "/acbib/request") {
		return false
	}
	for _, cookie := range cookies {
		name := strings.ToLower(cookie.Name)
		if strings.Contains(name, "session") || strings.Contains(name, "jsession") {
			return cookie.Value != ""
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

func signalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
