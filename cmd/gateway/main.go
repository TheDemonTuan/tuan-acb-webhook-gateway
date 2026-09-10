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
	"strings"
	"syscall"
	"time"

	"github.com/thedemontuan/tuan-bank-gateway/internal/acb"
	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
	"github.com/thedemontuan/tuan-bank-gateway/internal/httpapi"
	"github.com/thedemontuan/tuan-bank-gateway/internal/lock"
	"github.com/thedemontuan/tuan-bank-gateway/internal/monitor"
	"github.com/thedemontuan/tuan-bank-gateway/internal/security"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
	"github.com/thedemontuan/tuan-bank-gateway/internal/webhook"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "verify server health via HTTP")
	flag.Parse()
	if *healthcheck {
		client := &http.Client{Timeout: 3 * time.Second}
		ports := []string{"8090", "8080"}
		if addr := os.Getenv("LISTEN_ADDR"); addr != "" {
			if _, p, err := net.SplitHostPort(addr); err == nil {
				ports = append([]string{p}, ports...)
			}
		}
		for _, p := range ports {
			resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%s/healthz", p))
			if err == nil && resp.StatusCode == http.StatusOK {
				return
			}
		}
		os.Exit(1)
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

	dispatcher := webhook.NewDispatcher(store, nil)
	go dispatcher.Run(ctx)

	var keyring *security.Keyring
	if cfg.MasterKeyFile != "" {
		keyring, err = security.LoadKeyring(cfg.MasterKeyFile)
		if err != nil {
			logger.Error("load session encryption key", "error", err)
			os.Exit(1)
		}
	}
	acbClient, err := acb.NewClient("https://online.acb.com.vn", nil)
	if err != nil {
		logger.Error("create ACB client", "error", err)
		os.Exit(1)
	}
	bankMonitor := monitor.New(store, acbClient, cfg.PollInterval)
	if keyring != nil {
		bankMonitor.WithSessionLoader(monitor.NewSessionLoader(store, keyring, acbClient))
	}
	go bankMonitor.Run(ctx)

	primaryAddr := cfg.Address
	addresses := []string{primaryAddr}
	if strings.HasSuffix(primaryAddr, ":8090") {
		addresses = append(addresses, strings.TrimSuffix(primaryAddr, ":8090")+":8080")
	} else if strings.HasSuffix(primaryAddr, ":8080") {
		addresses = append(addresses, strings.TrimSuffix(primaryAddr, ":8080")+":8090")
	}

	handler := httpapi.New(cfg, store).Handler()
	var servers []*http.Server
	errCh := make(chan error, len(addresses))

	for _, addr := range addresses {
		srv := &http.Server{
			Addr:              addr,
			Handler:           handler,
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       15 * time.Second,
			WriteTimeout:      30 * time.Second,
			IdleTimeout:       60 * time.Second,
			MaxHeaderBytes:    1 << 20,
		}
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			logger.Warn("could not listen on address", "address", addr, "error", err)
			continue
		}
		servers = append(servers, srv)
		logger.Info("gateway listening", "address", addr)
		go func(s *http.Server, l net.Listener) {
			errCh <- s.Serve(l)
		}(srv, ln)
	}
	if len(servers) == 0 {
		logger.Error("no listener could be started")
		os.Exit(1)
	}

	select {
	case <-ctx.Done():
		logger.Info("gateway shutting down")
		shutdownCtx, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		for _, srv := range servers {
			_ = srv.Shutdown(shutdownCtx)
		}
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}
}
