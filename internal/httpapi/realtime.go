package httpapi

import (
	"context"
	"log/slog"
	"time"

	"github.com/thedemontuan/acb-transaction-webhook/internal/eventhub"
)

func (s *Server) Publish(event eventhub.Event) {
	if s.eventHub != nil {
		s.eventHub.Publish(event)
	}
}

func (s *Server) RunJournalRetention(ctx context.Context, retention time.Duration) {
	if retention <= 0 {
		retention = 24 * time.Hour
	}
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if _, err := s.store.DeleteJournalBefore(ctx, now.Add(-retention)); err != nil {
				slog.Warn("event journal retention failed", "error", err)
			}
		}
	}
}
