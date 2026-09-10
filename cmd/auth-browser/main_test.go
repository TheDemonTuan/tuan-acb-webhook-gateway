package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
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
