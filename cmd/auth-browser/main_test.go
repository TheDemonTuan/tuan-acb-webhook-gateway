package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/cdproto/network"
	"github.com/thedemontuan/tuan-bank-gateway/internal/authbrowser"
)

func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}
	defer os.Exit(0)
	args := os.Args
	for len(args) > 0 {
		if args[0] == "--" {
			args = args[1:]
			break
		}
		args = args[1:]
	}
	if len(args) == 0 {
		return
	}
	mode := args[0]
	switch mode {
	case "exit1":
		os.Exit(1)
	case "mock-browser":
		var port string
		for _, arg := range args {
			if strings.HasPrefix(arg, "--remote-debugging-port=") {
				port = strings.TrimPrefix(arg, "--remote-debugging-port=")
			}
		}
		if port != "" {
			listener, err := net.Listen("tcp", "127.0.0.1:"+port)
			if err == nil {
				mux := http.NewServeMux()
				mux.HandleFunc("/json/version", func(w http.ResponseWriter, r *http.Request) {
					_ = json.NewEncoder(w).Encode(map[string]string{
						"webSocketDebuggerUrl": "ws://127.0.0.1:" + port + "/devtools/browser/1",
					})
				})
				server := &http.Server{Handler: mux}
				go server.Serve(listener)
				defer server.Close()
			}
		}
		time.Sleep(30 * time.Second)
	case "sleep":
		time.Sleep(30 * time.Second)
	}
}

func fakeBrowserCmd(ctx context.Context, mode string, extraArgs ...string) *exec.Cmd {
	args := []string{"-test.run=TestHelperProcess", "--", mode}
	args = append(args, extraArgs...)
	cmd := exec.CommandContext(ctx, os.Args[0], args...)
	cmd.Env = append(os.Environ(), "GO_WANT_HELPER_PROCESS=1")
	return cmd
}

func TestWaitBrowserReady(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/json/version" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"webSocketDebuggerUrl": "ws://127.0.0.1/devtools/browser/1"})
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan struct{})
	if err := waitBrowserReady(ctx, server.URL, done, nil); err != nil {
		t.Fatal(err)
	}
}

func TestWaitBrowserReadyReportsEarlyExit(t *testing.T) {
	done := make(chan struct{})
	close(done)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	item := &browserSession{exitErr: errors.New("exit status 1")}
	if err := waitBrowserReady(ctx, "http://127.0.0.1:1", done, item); err == nil {
		t.Fatal("expected early exit error")
	}
}

func TestEncodeHandoffKeepsCookiesBeforeNonce(t *testing.T) {
	handoff, err := encodeHandoff([]*network.Cookie{{Name: "JSESSIONID", Value: "secret", Domain: ".acb.com.vn", Path: "/"}})
	if err != nil {
		t.Fatal(err)
	}
	encodedCookies, encodedNonce, ok := strings.Cut(handoff, ".")
	if !ok || encodedNonce == "" {
		t.Fatalf("invalid handoff framing: %q", handoff)
	}
	payload, err := base64.RawURLEncoding.DecodeString(encodedCookies)
	if err != nil {
		t.Fatal(err)
	}
	var cookies []authbrowser.Cookie
	if err := json.Unmarshal(payload, &cookies); err != nil {
		t.Fatal(err)
	}
	if len(cookies) != 1 || cookies[0].Name != "JSESSIONID" || cookies[0].Value != "secret" {
		t.Fatalf("unexpected cookies: %+v", cookies)
	}
}

func TestAuthenticatedACBRejectsLoginRoutes(t *testing.T) {
	cookies := []*network.Cookie{{Domain: ".acb.com.vn", Value: "present"}}
	rejected := []string{
		"https://online.acb.com.vn/login",
		"https://online.acb.com.vn/acbib/Request?op=OBKLoginOp",
		"https://online.acb.com.vn/acbib/Request",
		"https://online.acb.com.vn",
		"https://example.com/home",
	}
	for _, location := range rejected {
		if authenticatedACB(location, cookies) {
			t.Fatalf("authenticated login URL %q", location)
		}
	}
	if !authenticatedACB("https://online.acb.com.vn/acbib/AccountSummary", cookies) {
		t.Fatal("rejected authenticated ACB URL")
	}
}

func TestTerminalStatus(t *testing.T) {
	for _, status := range []string{"FAILED", "EXPIRED", "CANCELLED", "COMPLETED"} {
		if !terminalStatus(status) {
			t.Fatalf("expected %s to be terminal", status)
		}
	}
	if terminalStatus("AWAITING_USER_LOGIN") {
		t.Fatal("waiting status must not be terminal")
	}
	if terminalStatus("STARTING") {
		t.Fatal("starting status must not be terminal")
	}
	if terminalStatus("VERIFIED") {
		t.Fatal("verified status must not be terminal")
	}
}

func TestAllocateFreePort(t *testing.T) {
	port1, err := allocateFreePort()
	if err != nil {
		t.Fatalf("allocate port 1: %v", err)
	}
	port2, err := allocateFreePort()
	if err != nil {
		t.Fatalf("allocate port 2: %v", err)
	}
	if port1 <= 0 || port2 <= 0 {
		t.Fatalf("invalid ports allocated: %d, %d", port1, port2)
	}
	if port1 == 9222 || port2 == 9222 {
		t.Fatalf("unexpected hardcoded port 9222 allocated: %d, %d", port1, port2)
	}
}

func TestSafeStatusTransitions(t *testing.T) {
	s := &server{
		session: &browserSession{
			AttemptID: "test-attempt",
			Status:    "AWAITING_USER_LOGIN",
		},
	}

	// Transition from waiting to verified
	if !s.setStatus("test-attempt", "VERIFIED", "") {
		t.Fatal("expected status transition to VERIFIED to succeed")
	}
	if s.session.Status != "VERIFIED" {
		t.Fatalf("got status %q, want VERIFIED", s.session.Status)
	}

	// Transition from verified to cancelled (terminal)
	if !s.setStatus("test-attempt", "CANCELLED", "") {
		t.Fatal("expected status transition to CANCELLED to succeed")
	}

	// Attempting to overwrite terminal status with FAILED must fail
	if s.setStatus("test-attempt", "FAILED", "some error") {
		t.Fatal("expected setStatus to reject transition from terminal CANCELLED")
	}
	if s.session.Status != "CANCELLED" {
		t.Fatalf("terminal status was overwritten: %q", s.session.Status)
	}

	// Attempting to overwrite with EXPIRED must also fail
	if s.setStatus("test-attempt", "EXPIRED", "expired") {
		t.Fatal("expected setStatus to reject transition from terminal CANCELLED")
	}
	if s.session.Status != "CANCELLED" {
		t.Fatalf("terminal status was overwritten: %q", s.session.Status)
	}
}

func TestCancelReapsProcessAndPreservesCancelledStatus(t *testing.T) {
	profileDir := t.TempDir()
	s := &server{
		profiles: profileDir,
		cmdFunc: func(ctx context.Context, name string, args ...string) *exec.Cmd {
			return fakeBrowserCmd(ctx, "mock-browser", args...)
		},
	}

	body := bytes.NewBufferString(`{"attemptId":"cancel-reap-test"}`)
	req := httptest.NewRequest(http.MethodPost, "/sessions", body)
	w := httptest.NewRecorder()
	s.start(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("start returned HTTP %d: %s", w.Code, w.Body.String())
	}

	session := s.session
	if session == nil || session.AttemptID != "cancel-reap-test" {
		t.Fatal("session not created")
	}
	if session.Status != "AWAITING_USER_LOGIN" {
		t.Fatalf("got status %q, want AWAITING_USER_LOGIN", session.Status)
	}

	// Cancel session
	cancelReq := httptest.NewRequest(http.MethodDelete, "/sessions/cancel-reap-test", nil)
	cancelReq.SetPathValue("attemptID", "cancel-reap-test")
	cancelW := httptest.NewRecorder()
	s.cancel(cancelW, cancelReq)
	if cancelW.Code != http.StatusNoContent {
		t.Fatalf("cancel returned HTTP %d", cancelW.Code)
	}

	// Process must be reaped (done channel closed)
	select {
	case <-session.done:
	default:
		t.Fatal("process was not reaped after cancel")
	}

	// Check status: must NOT be 404! It must return 200 with CANCELLED
	statusReq := httptest.NewRequest(http.MethodGet, "/sessions/cancel-reap-test/status", nil)
	statusReq.SetPathValue("attemptID", "cancel-reap-test")
	statusW := httptest.NewRecorder()
	s.status(statusW, statusReq)
	if statusW.Code != http.StatusOK {
		t.Fatalf("status after cancel returned HTTP %d: %s (expected 200 OK)", statusW.Code, statusW.Body.String())
	}

	var statusResp browserSession
	if err := json.NewDecoder(statusW.Body).Decode(&statusResp); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if statusResp.Status != "CANCELLED" {
		t.Fatalf("got status %q, want CANCELLED", statusResp.Status)
	}
}

func TestRestartReapsTerminalSession(t *testing.T) {
	profileDir := t.TempDir()
	s := &server{
		profiles: profileDir,
		cmdFunc: func(ctx context.Context, name string, args ...string) *exec.Cmd {
			return fakeBrowserCmd(ctx, "mock-browser", args...)
		},
	}

	// Start first session
	w1 := httptest.NewRecorder()
	s.start(w1, httptest.NewRequest(http.MethodPost, "/sessions", bytes.NewBufferString(`{"attemptId":"session-1"}`)))
	if w1.Code != http.StatusCreated {
		t.Fatalf("first start failed: HTTP %d %s", w1.Code, w1.Body.String())
	}
	sess1 := s.session

	// Cancel first session
	cancelReq := httptest.NewRequest(http.MethodDelete, "/sessions/session-1", nil)
	cancelReq.SetPathValue("attemptID", "session-1")
	cancelW := httptest.NewRecorder()
	s.cancel(cancelW, cancelReq)
	if cancelW.Code != http.StatusNoContent {
		t.Fatalf("cancel failed: HTTP %d", cancelW.Code)
	}

	// Start second session immediately - must succeed without 409 conflict
	w2 := httptest.NewRecorder()
	s.start(w2, httptest.NewRequest(http.MethodPost, "/sessions", bytes.NewBufferString(`{"attemptId":"session-2"}`)))
	if w2.Code != http.StatusCreated {
		t.Fatalf("second start failed: HTTP %d %s", w2.Code, w2.Body.String())
	}
	sess2 := s.session

	if sess2.AttemptID != "session-2" {
		t.Fatalf("expected session-2, got %q", sess2.AttemptID)
	}
	if sess1.debugURL == sess2.debugURL {
		t.Fatalf("both sessions got identical debugURL: %s", sess1.debugURL)
	}

	// Clean up second session
	s.stopCurrent()
}

func TestActiveSessionConflict(t *testing.T) {
	profileDir := t.TempDir()
	s := &server{
		profiles: profileDir,
		cmdFunc: func(ctx context.Context, name string, args ...string) *exec.Cmd {
			return fakeBrowserCmd(ctx, "mock-browser", args...)
		},
	}
	defer s.stopCurrent()

	w1 := httptest.NewRecorder()
	s.start(w1, httptest.NewRequest(http.MethodPost, "/sessions", bytes.NewBufferString(`{"attemptId":"active-1"}`)))
	if w1.Code != http.StatusCreated {
		t.Fatalf("start 1 returned HTTP %d: %s", w1.Code, w1.Body.String())
	}

	w2 := httptest.NewRecorder()
	s.start(w2, httptest.NewRequest(http.MethodPost, "/sessions", bytes.NewBufferString(`{"attemptId":"active-2"}`)))
	if w2.Code != http.StatusConflict {
		t.Fatalf("start 2 returned HTTP %d (expected 409 Conflict): %s", w2.Code, w2.Body.String())
	}
}

func TestFakeProcessStartupFailureCleanedUp(t *testing.T) {
	profileDir := t.TempDir()
	s := &server{
		profiles: profileDir,
		cmdFunc: func(ctx context.Context, name string, args ...string) *exec.Cmd {
			return fakeBrowserCmd(ctx, "exit1", args...)
		},
	}

	w := httptest.NewRecorder()
	s.start(w, httptest.NewRequest(http.MethodPost, "/sessions", bytes.NewBufferString(`{"attemptId":"fail-startup"}`)))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("got HTTP %d, want 503 Service Unavailable: %s", w.Code, w.Body.String())
	}

	if s.session.Status != "FAILED" {
		t.Fatalf("got status %q, want FAILED", s.session.Status)
	}

	// Profile directory must be cleaned up
	profilePath := filepath.Join(profileDir, "fail-startup")
	if _, err := os.Stat(profilePath); !os.IsNotExist(err) {
		t.Fatalf("profile directory %q was not cleaned up after startup failure", profilePath)
	}
}

func TestObserverBoundedRetryPreservesSession(t *testing.T) {
	s := &server{
		session: &browserSession{
			AttemptID: "observer-retry-test",
			Status:    "AWAITING_USER_LOGIN",
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	done := make(chan struct{})
	// Point to an unavailable endpoint: 127.0.0.1 on a port not in use
	go s.observeLogin(ctx, "observer-retry-test", "http://127.0.0.1:59999", done)

	// Wait for context to expire (observer will have retried several times)
	<-ctx.Done()

	// Crucial: The session must NOT be marked FAILED or CANCELLED by the observer
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session.Status != "AWAITING_USER_LOGIN" {
		t.Fatalf("observer mutated session status: %q (expected AWAITING_USER_LOGIN)", s.session.Status)
	}
}

func TestHandoffReapsProcessAndSetsCompleted(t *testing.T) {
	profileDir := t.TempDir()
	s := &server{
		profiles: profileDir,
		cmdFunc: func(ctx context.Context, name string, args ...string) *exec.Cmd {
			return fakeBrowserCmd(ctx, "mock-browser", args...)
		},
	}

	w := httptest.NewRecorder()
	s.start(w, httptest.NewRequest(http.MethodPost, "/sessions", bytes.NewBufferString(`{"attemptId":"handoff-test"}`)))
	if w.Code != http.StatusCreated {
		t.Fatalf("start failed: HTTP %d %s", w.Code, w.Body.String())
	}
	session := s.session

	// Simulate successful verification
	s.mu.Lock()
	session.verified = true
	session.handoff = "test-token.nonce"
	session.Status = "VERIFIED"
	s.mu.Unlock()

	// Call handoff
	handoffReq := httptest.NewRequest(http.MethodPost, "/sessions/handoff-test/handoff", nil)
	handoffReq.SetPathValue("attemptID", "handoff-test")
	handoffW := httptest.NewRecorder()
	s.handoff(handoffW, handoffReq)
	if handoffW.Code != http.StatusOK {
		t.Fatalf("handoff returned HTTP %d: %s", handoffW.Code, handoffW.Body.String())
	}

	var resp struct {
		Session string `json:"session"`
	}
	if err := json.NewDecoder(handoffW.Body).Decode(&resp); err != nil {
		t.Fatalf("decode handoff response: %v", err)
	}
	if resp.Session != "test-token.nonce" {
		t.Fatalf("got session token %q, want test-token.nonce", resp.Session)
	}

	// Process must be reaped
	select {
	case <-session.done:
	default:
		t.Fatal("process was not reaped after handoff")
	}

	// Status must be COMPLETED
	statusReq := httptest.NewRequest(http.MethodGet, "/sessions/handoff-test/status", nil)
	statusReq.SetPathValue("attemptID", "handoff-test")
	statusW := httptest.NewRecorder()
	s.status(statusW, statusReq)
	if statusW.Code != http.StatusOK {
		t.Fatalf("status returned HTTP %d: %s", statusW.Code, statusW.Body.String())
	}
	var statusResp browserSession
	if err := json.NewDecoder(statusW.Body).Decode(&statusResp); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if statusResp.Status != "COMPLETED" {
		t.Fatalf("got status %q, want COMPLETED", statusResp.Status)
	}

	// Second handoff call must be rejected with 409
	handoffW2 := httptest.NewRecorder()
	s.handoff(handoffW2, handoffReq)
	if handoffW2.Code != http.StatusConflict {
		t.Fatalf("second handoff returned HTTP %d (expected 409 Conflict)", handoffW2.Code)
	}
}

func TestRealChromiumIntegration(t *testing.T) {
	browserBin := findDefaultBrowser()
	if browserBin == "" || browserBin == "chromium" {
		if _, err := exec.LookPath("chromium"); err != nil {
			t.Skip("no local Chromium or Edge installed, skipping real integration test")
		}
	}

	profileDir := t.TempDir()
	s := &server{
		profiles:    profileDir,
		browserExec: browserBin,
		extraFlags:  []string{"--headless=new"},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	port, err := allocateFreePort()
	if err != nil {
		t.Fatalf("allocate free port: %v", err)
	}

	item := &browserSession{
		AttemptID: "real-browser-test",
		Status:    "STARTING",
		ScreenURL: "/",
		ExpiresAt: time.Now().UTC().Add(sessionTTL),
		cancel:    cancel,
		debugURL:  fmt.Sprintf("http://127.0.0.1:%d", port),
		done:      make(chan struct{}),
	}
	s.session = item

	ready := make(chan error, 1)
	go s.launch(ctx, item, port, ready)

	select {
	case err := <-ready:
		if err != nil {
			t.Fatalf("real browser launch failed: %v", err)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("timed out waiting for real browser ready")
	}

	if item.Status != "AWAITING_USER_LOGIN" {
		t.Fatalf("got status %q, want AWAITING_USER_LOGIN", item.Status)
	}

	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-item.done:
			t.Fatalf("real browser exited while observer was active: %v", item.exitErr)
		case <-time.After(250 * time.Millisecond):
		}
		s.mu.Lock()
		status := item.Status
		s.mu.Unlock()
		if status != "AWAITING_USER_LOGIN" {
			t.Fatalf("observer changed status to %q before login", status)
		}
	}

	// Cancel and reap
	s.reapSession(item, 5*time.Second)

	select {
	case <-item.done:
	default:
		t.Fatal("real browser was not reaped")
	}

	// Verify profile is deleted
	profilePath := filepath.Join(profileDir, "real-browser-test")
	if _, err := os.Stat(profilePath); !os.IsNotExist(err) {
		t.Fatalf("profile directory was not cleaned up: %v", err)
	}
}
