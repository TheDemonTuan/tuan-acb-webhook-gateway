package webhook

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/thedemontuan/acb-transaction-webhook/internal/storage"
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
	store      *storage.Store
	httpClient *http.Client
	maxRetries int
	backoffs   []time.Duration
}

func NewDispatcher(store *storage.Store, client *http.Client) *Dispatcher {
	if client == nil {
		client = &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				DialContext: PublicDialer{Dialer: net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}}.DialContext,
			},
		}
	}
	return &Dispatcher{
		store:      store,
		httpClient: client,
		maxRetries: len(defaultBackoffs),
		backoffs:   defaultBackoffs,
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
		_ = d.store.FailDelivery(ctx, delivery.ID, "ENDPOINT_UNAVAILABLE")
		return true, fmt.Errorf("fetch endpoint details: %w", err)
	}

	payload, err := d.store.EventPayload(ctx, delivery.EventID)
	if err != nil {
		_ = d.store.FailDelivery(ctx, delivery.ID, "EVENT_PAYLOAD_UNAVAILABLE")
		return true, fmt.Errorf("fetch event payload: %w", err)
	}

	nonce, err := NewNonce()
	if err != nil {
		return true, err
	}

	signed := Sign(secret, payload, now, nonce)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(payload))
	if err != nil {
		_ = d.store.FailDelivery(ctx, delivery.ID, "INVALID_URL")
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
	if success {
		err = d.store.CompleteDelivery(ctx, delivery, true, time.Time{})
		return true, err
	}

	// Retry or dead-letter
	if delivery.Attempts >= d.maxRetries {
		err = d.store.FailDelivery(ctx, delivery.ID, fmt.Sprintf("EXHAUSTED_RETRIES_STATUS_%d", httpStatus))
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
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for {
				processed, err := d.DispatchOne(ctx)
				if err != nil {
					slog.Warn("webhook dispatch error", "error", err)
				}
				if !processed || err != nil {
					break
				}
			}
		}
	}
}
