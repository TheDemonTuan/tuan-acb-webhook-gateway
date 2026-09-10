package storage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

type EndpointWithSecret struct {
	Endpoint
	Secret string `json:"secret,omitempty"`
}

func (s *Store) CreateEndpointWithSecret(ctx context.Context, name, targetURL string) (EndpointWithSecret, error) {
	if name == "" || targetURL == "" {
		return EndpointWithSecret{}, errors.New("name and URL are required")
	}
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		return EndpointWithSecret{}, err
	}
	secretHex := hex.EncodeToString(secretBytes)
	epID := id("ep")
	createdAt := now()

	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO webhook_endpoints(id,name,status,current_revision,created_at,updated_at) VALUES(?,?,?,1,?,?)`, epID, name, "DISABLED", createdAt, createdAt); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO endpoint_versions(endpoint_id,revision,url,filters_json,created_at) VALUES(?,1,?,'[]',?)`, epID, targetURL, createdAt); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO endpoint_secrets(endpoint_id,key_id,envelope,status,created_at) VALUES(?,'k1',?,'ACTIVE',?)`, epID, []byte(secretHex), createdAt)
		return err
	})
	if err != nil {
		return EndpointWithSecret{}, err
	}

	return EndpointWithSecret{
		Endpoint: Endpoint{
			ID:        epID,
			Name:      name,
			URL:       targetURL,
			Status:    "DISABLED",
			Revision:  1,
			CreatedAt: createdAt,
			UpdatedAt: createdAt,
		},
		Secret: secretHex,
	}, nil
}

func (s *Store) EndpointDetails(ctx context.Context, endpointID string) (url string, secret []byte, err error) {
	var sec []byte
	err = s.db.QueryRowContext(ctx, `
		SELECT v.url, s.envelope
		FROM webhook_endpoints e
		JOIN endpoint_versions v ON v.endpoint_id = e.id AND v.revision = e.current_revision
		JOIN endpoint_secrets s ON s.endpoint_id = e.id AND s.status = 'ACTIVE'
		WHERE e.id = ?
		LIMIT 1
	`, endpointID).Scan(&url, &sec)
	if err != nil {
		return "", nil, err
	}
	return url, sec, nil
}

func (s *Store) EventPayload(ctx context.Context, eventID string) ([]byte, error) {
	var payload []byte
	err := s.db.QueryRowContext(ctx, `SELECT payload FROM events WHERE id = ?`, eventID).Scan(&payload)
	return payload, err
}

func (s *Store) EmitTransactionEvent(ctx context.Context, transactionID, eventType, namespace, semanticKey string, data any) (string, error) {
	dataBytes, err := json.Marshal(data)
	if err != nil {
		return "", err
	}

	sum := sha256.Sum256([]byte(namespace + "\x00" + semanticKey + "\x00" + eventType))
	eventID := "bevt_" + hex.EncodeToString(sum[:16])
	payloadHash := hex.EncodeToString(sum[:])
	createdAt := now()

	err = s.withTx(ctx, func(tx *sql.Tx) error {
		// Insert event if not exists
		_, err := tx.ExecContext(ctx, `
			INSERT INTO events(id, transaction_id, event_type, payload, payload_hash, created_at)
			VALUES(?, ?, ?, ?, ?, ?)
			ON CONFLICT(transaction_id, event_type) DO NOTHING
		`, eventID, transactionID, eventType, dataBytes, payloadHash, createdAt)
		if err != nil {
			return err
		}

		// Queue delivery to all active endpoints
		rows, err := tx.QueryContext(ctx, `SELECT id, current_revision FROM webhook_endpoints WHERE status = 'ACTIVE'`)
		if err != nil {
			return err
		}
		defer rows.Close()

		type epInfo struct {
			id       string
			revision int
		}
		var endpoints []epInfo
		for rows.Next() {
			var ep epInfo
			if err := rows.Scan(&ep.id, &ep.revision); err != nil {
				return err
			}
			endpoints = append(endpoints, ep)
		}
		if err := rows.Err(); err != nil {
			return err
		}

		for _, ep := range endpoints {
			deliveryID := id("del")
			_, err := tx.ExecContext(ctx, `
				INSERT INTO deliveries(id, event_id, endpoint_id, endpoint_revision, key_id, status, attempts, next_attempt_at, created_at, updated_at)
				VALUES(?, ?, ?, ?, 'k1', 'PENDING', 0, ?, ?, ?)
				ON CONFLICT(event_id, endpoint_id) DO NOTHING
			`, deliveryID, eventID, ep.id, ep.revision, createdAt, createdAt, createdAt)
			if err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		return "", fmt.Errorf("emit transaction event: %w", err)
	}
	return eventID, nil
}

func (s *Store) FailDelivery(ctx context.Context, deliveryID, reason string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE deliveries SET status='DEAD_LETTER', updated_at=? WHERE id=?`, now(), deliveryID)
	return err
}

func (s *Store) RecordAttempt(ctx context.Context, deliveryID string, attemptNum, httpStatus, durationMs int, errStr string) error {
	attemptID := id("att")
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO delivery_attempts(id, delivery_id, attempt_number, http_status, duration_ms, error_envelope, executed_at)
		VALUES(?, ?, ?, ?, ?, ?, ?)
	`, attemptID, deliveryID, attemptNum, httpStatus, durationMs, []byte(errStr), now())
	return err
}
