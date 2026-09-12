package webhook

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/thedemontuan/acb-transaction-webhook/internal/storage"
	"github.com/thedemontuan/acb-transaction-webhook/internal/telemetry"
)

var defaultBackoffs = []time.Duration{
	2 * time.Second,
	5 * time.Second,
	15 * time.Second,
	30 * time.Second,
	1 * time.Minute,
	2 * time.Minute,
	5 * time.Minute,
	15 * time.Minute,
}

type Dispatcher struct {
	store             *storage.Store
	httpClient        *http.Client
	maxRetries        int
	backoffs          []time.Duration
	skipURLValidation bool
	wakeCh            chan struct{}
}

func (d *Dispatcher) SetSkipURLValidation(skip bool) *Dispatcher {
	d.skipURLValidation = skip
	return d
}

func (d *Dispatcher) Wake() {
	select {
	case d.wakeCh <- struct{}{}:
	default:
	}
}

func NewDispatcher(store *storage.Store, client *http.Client) *Dispatcher {
	if client == nil {
		client = NewHTTPClient()
	}
	return &Dispatcher{
		store:      store,
		httpClient: client,
		maxRetries: len(defaultBackoffs),
		backoffs:   defaultBackoffs,
		wakeCh:     make(chan struct{}, 1),
	}
}

// DispatchOne claims and attempts to dispatch a single pending delivery.
// Returns (true, nil) if a delivery was processed, (false, nil) if none available.
func (d *Dispatcher) DispatchOne(ctx context.Context) (bool, error) {
	now := time.Now().UTC()
	delivery, err := d.store.ClaimDelivery(ctx, now, 30*time.Second)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	targetURL, secret, err := d.store.EndpointDetails(ctx, delivery.EndpointID)
	if err != nil {
		_ = d.store.FailDelivery(ctx, delivery.ID, delivery.ClaimToken, "ENDPOINT_UNAVAILABLE")
		return true, fmt.Errorf("fetch endpoint details: %w", err)
	}

	if !d.skipURLValidation {
		if _, err := ValidateURL(targetURL); err != nil {
			_ = d.store.FailDelivery(ctx, delivery.ID, delivery.ClaimToken, "INVALID_ENDPOINT_URL")
			return true, fmt.Errorf("invalid endpoint URL: %w", err)
		}
	}

	payload, err := d.store.EventPayload(ctx, delivery.EventID)
	if err != nil {
		_ = d.store.FailDelivery(ctx, delivery.ID, delivery.ClaimToken, "EVENT_PAYLOAD_UNAVAILABLE")
		return true, fmt.Errorf("fetch event payload: %w", err)
	}

	nonce, err := NewNonce()
	if err != nil {
		return true, err
	}

	signed := Sign(secret, payload, now, nonce)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(payload))
	if err != nil {
		_ = d.store.FailDelivery(ctx, delivery.ID, delivery.ClaimToken, "INVALID_URL")
		return true, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Bank-Event-Id", delivery.EventID)
	req.Header.Set("X-Bank-Delivery-Id", delivery.ID)
	req.Header.Set("X-Bank-Timestamp", signed.Timestamp)
	req.Header.Set("X-Bank-Nonce", signed.Nonce)
	req.Header.Set("X-Bank-Signature", signed.Signature)

	start := time.Now()
	resp, reqErr := d.httpClient.Do(req)
	duration := int(time.Since(start).Milliseconds())

	httpStatus := 0
	errString := ""
	if reqErr != nil {
		errString = reqErr.Error()
	} else {
		httpStatus = resp.StatusCode
		_ = resp.Body.Close()
	}

	_ = d.store.RecordAttempt(ctx, delivery.ID, delivery.Attempts, httpStatus, duration, errString)

	success := reqErr == nil && httpStatus >= 200 && httpStatus < 300
	telemetry.Default.RecordWebhook(time.Since(start), success)
	if success {
		err = d.store.CompleteDelivery(ctx, delivery, true, time.Time{})
		return true, err
	}

	// Retry or dead-letter
	if delivery.Attempts >= d.maxRetries {
		err = d.store.FailDelivery(ctx, delivery.ID, delivery.ClaimToken, fmt.Sprintf("EXHAUSTED_RETRIES_STATUS_%d", httpStatus))
		return true, err
	}

	backoffIdx := delivery.Attempts - 1
	if backoffIdx < 0 {
		backoffIdx = 0
	}
	if backoffIdx >= len(d.backoffs) {
		backoffIdx = len(d.backoffs) - 1
	}
	nextAttempt := now.Add(d.backoffs[backoffIdx])

	err = d.store.CompleteDelivery(ctx, delivery, false, nextAttempt)
	return true, err
}

func (d *Dispatcher) Run(ctx context.Context) {
	const workers = 4
	jobs := make(chan struct{}, workers)
	for i := 0; i < workers; i++ {
		go func() {
			for range jobs {
				d.drain(ctx)
			}
		}()
	}

	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			close(jobs)
			return
		case <-d.wakeCh:
		case <-timer.C:
		}
		for i := 0; i < workers; i++ {
			select {
			case jobs <- struct{}{}:
			default:
			}
		}
		timer.Reset(d.nextWait(ctx))
	}
}

func (d *Dispatcher) nextWait(ctx context.Context) time.Duration {
	due, err := d.store.NextDeliveryDue(ctx)
	if err != nil {
		return 15 * time.Second
	}
	wait := time.Until(due)
	if wait < 0 {
		return 0
	}
	if wait > 15*time.Second {
		return 15 * time.Second
	}
	return wait
}

func (d *Dispatcher) drain(ctx context.Context) {
	const maxBurst = 50
	for i := 0; i < maxBurst; i++ {
		if ctx.Err() != nil {
			return
		}
		processed, err := d.DispatchOne(ctx)
		if err != nil {
			slog.Warn("webhook dispatch error", "error", err)
		}
		if !processed || err != nil {
			break
		}
	}
}
