package telemetry

import (
	"testing"
	"time"
)

func TestMetricsP95Calculation(t *testing.T) {
	reg := NewRegistry()

	for i := 1; i <= 100; i++ {
		reg.RecordIngest(time.Duration(i) * time.Millisecond)
		reg.RecordSSE(time.Duration(i*2) * time.Millisecond)
		reg.RecordWebhook(time.Duration(i*3) * time.Millisecond)
	}

	reg.SetConnectedClients(5)
	reg.SetCircuitBreaker(false)
	reg.SetLastACBPollAt(time.Now())

	rep := reg.Report()
	if rep.ConnectedClients != 5 {
		t.Fatalf("expected 5 connected clients, got %d", rep.ConnectedClients)
	}
	if rep.P95IngestMs < 94 || rep.P95IngestMs > 96 {
		t.Fatalf("expected p95 ingest ~95ms, got %f", rep.P95IngestMs)
	}
	if rep.P95SSEMs < 188 || rep.P95SSEMs > 192 {
		t.Fatalf("expected p95 sse ~190ms, got %f", rep.P95SSEMs)
	}
	if rep.P95WebhookMs < 282 || rep.P95WebhookMs > 288 {
		t.Fatalf("expected p95 webhook ~285ms, got %f", rep.P95WebhookMs)
	}
}
