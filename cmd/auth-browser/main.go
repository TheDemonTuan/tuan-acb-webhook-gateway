// auth-browser is intentionally a minimal private controller scaffold.
// Browser automation, mTLS RPC and noVNC are added only after PR 0 proves the
// authorized ACB session handoff in the target VPS environment.
package main

import (
	"log/slog"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	slog.Info("auth browser controller idle", "mode", "not_configured")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	<-signals
	slog.Info("auth browser controller stopped")
}
