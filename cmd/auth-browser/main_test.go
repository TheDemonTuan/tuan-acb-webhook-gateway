package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/cdproto/network"
	"github.com/thedemontuan/tuan-bank-gateway/internal/authbrowser"
)

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
	if err := waitBrowserReady(ctx, server.URL, make(chan error)); err != nil {
		t.Fatal(err)
	}
}

func TestWaitBrowserReadyReportsEarlyExit(t *testing.T) {
	exited := make(chan error, 1)
	exited <- errors.New("exit status 1")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := waitBrowserReady(ctx, "http://127.0.0.1:1", exited); err == nil {
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
	for _, location := range []string{"https://online.acb.com.vn/login", "https://online.acb.com.vn/acbib/Request?op=OBKLoginOp", "https://example.com/home"} {
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
}
