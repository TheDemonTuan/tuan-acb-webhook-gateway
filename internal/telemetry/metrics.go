package telemetry

import (
	"sort"
	"sync"
	"time"
)

type RealtimeMetricsReport struct {
	ConnectedClients   int64   `json:"connectedClients"`
	CircuitBreakerOpen bool    `json:"circuitBreakerOpen"`
	LastACBPollAt      string  `json:"lastAcbPollAt,omitempty"`
	P95IngestMs        float64 `json:"p95IngestMs"`
	P95SSEMs           float64 `json:"p95SseMs"`
	P95WebhookMs       float64 `json:"p95WebhookMs"`
	TotalIngested      int     `json:"totalIngested"`
	TotalWebhooksSent  int     `json:"totalWebhooksSent"`
}

type Registry struct {
	mu                 sync.RWMutex
	ingestSamples      []float64
	sseSamples         []float64
	webhookSamples     []float64
	connectedClients   int64
	circuitBreakerOpen bool
	lastACBPollAt      string
	totalIngested      int
	totalWebhooksSent  int
}

var Default = NewRegistry()

func NewRegistry() *Registry {
	return &Registry{
		ingestSamples:  make([]float64, 0, 1000),
		sseSamples:     make([]float64, 0, 1000),
		webhookSamples: make([]float64, 0, 1000),
	}
}

func (r *Registry) RecordIngest(d time.Duration) {
	ms := float64(d.Microseconds()) / 1000.0
	r.mu.Lock()
	defer r.mu.Unlock()
	r.totalIngested++
	if len(r.ingestSamples) >= 1000 {
		r.ingestSamples = r.ingestSamples[1:]
	}
	r.ingestSamples = append(r.ingestSamples, ms)
}

func (r *Registry) RecordSSE(d time.Duration) {
	ms := float64(d.Microseconds()) / 1000.0
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.sseSamples) >= 1000 {
		r.sseSamples = r.sseSamples[1:]
	}
	r.sseSamples = append(r.sseSamples, ms)
}

func (r *Registry) RecordWebhook(d time.Duration, delivered ...bool) {
	ms := float64(d.Microseconds()) / 1000.0
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(delivered) == 0 || delivered[0] {
		r.totalWebhooksSent++
	}
	if len(r.webhookSamples) >= 1000 {
		r.webhookSamples = r.webhookSamples[1:]
	}
	r.webhookSamples = append(r.webhookSamples, ms)
}

func (r *Registry) SetConnectedClients(count int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connectedClients = count
}

func (r *Registry) SetCircuitBreaker(open bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.circuitBreakerOpen = open
}

func (r *Registry) SetLastACBPollAt(t time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lastACBPollAt = t.UTC().Format(time.RFC3339)
}

func (r *Registry) Report() RealtimeMetricsReport {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return RealtimeMetricsReport{
		ConnectedClients:   r.connectedClients,
		CircuitBreakerOpen: r.circuitBreakerOpen,
		LastACBPollAt:      r.lastACBPollAt,
		P95IngestMs:        calcP95(r.ingestSamples),
		P95SSEMs:           calcP95(r.sseSamples),
		P95WebhookMs:       calcP95(r.webhookSamples),
		TotalIngested:      r.totalIngested,
		TotalWebhooksSent:  r.totalWebhooksSent,
	}
}

func calcP95(samples []float64) float64 {
	if len(samples) == 0 {
		return 0.0
	}
	copied := make([]float64, len(samples))
	copy(copied, samples)
	sort.Float64s(copied)
	idx := int(float64(len(copied)) * 0.95)
	if idx >= len(copied) {
		idx = len(copied) - 1
	}
	return copied[idx]
}
