package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
	"github.com/thedemontuan/tuan-bank-gateway/internal/httpapi"
	"github.com/thedemontuan/tuan-bank-gateway/internal/lock"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "verify server health via HTTP")
	flag.Parse()
	if *healthcheck {
		port := "8080"
		if addr := os.Getenv("LISTEN_ADDR"); addr != "" {
			if _, p, err := net.SplitHostPort(addr); err == nil {
				port = p
			}
		}
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%s/healthz", port))
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		return
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o750); err != nil {
		logger.Error("create data directory", "error", err)
		os.Exit(1)
	}
	fileLock, err := lock.Acquire(filepath.Join(filepath.Dir(cfg.DatabasePath), "gateway.lock"))
	if err != nil {
		logger.Error("gateway lock unavailable", "error", err)
		os.Exit(1)
	}
	defer fileLock.Close()
	store, err := storage.Open(ctx, cfg.DatabasePath)
	if err != nil {
		logger.Error("open storage", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	server := &http.Server{Addr: cfg.Address, Handler: httpapi.New(cfg, store).Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	errCh := make(chan error, 1)
	go func() { logger.Info("gateway listening", "address", cfg.Address); errCh <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
		logger.Info("gateway shutting down")
		shutdownCtx, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Error("graceful shutdown failed", "error", err)
		}
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}
}
