package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type AuthAttempt struct {
	ID           string `json:"id"`
	ConnectionID string `json:"connectionId"`
	Generation   int64  `json:"generation"`
	Status       string `json:"status"`
	ExpiresAt    string `json:"expiresAt"`
	CreatedAt    string `json:"createdAt"`
}

func (s *Store) StartAuthAttempt(ctx context.Context, owner string, ttl time.Duration) (AuthAttempt, error) {
	if ttl <= 0 {
		return AuthAttempt{}, errors.New("auth attempt TTL must be positive")
	}
	connection, err := s.Connection(ctx)
	if err != nil {
		return AuthAttempt{}, err
	}
	attempt := AuthAttempt{ID: id("auth"), ConnectionID: connection.ID, Generation: connection.Generation + 1, Status: "STARTING", ExpiresAt: time.Now().UTC().Add(ttl).Format(time.RFC3339Nano), CreatedAt: now()}
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE connections SET state='AUTH_STARTING',generation=?,updated_at=? WHERE id=? AND generation=?`, attempt.Generation, now(), connection.ID, connection.Generation)
		if err != nil {
			return err
		}
		changed, err := result.RowsAffected()
		if err != nil || changed != 1 {
			return sql.ErrNoRows
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO auth_attempts(id,connection_id,generation,owner_subject,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?)`, attempt.ID, attempt.ConnectionID, attempt.Generation, owner, attempt.Status, attempt.ExpiresAt, attempt.CreatedAt)
		return err
	})
	return attempt, err
}

func (s *Store) FinishAuthAttempt(ctx context.Context, attemptID, status string) error {
	if status != "CANCELLED" && status != "EXPIRED" && status != "FAILED" {
		return errors.New("invalid auth attempt finish status")
	}
	return s.withTx(ctx, func(tx *sql.Tx) error {
		var connectionID string
		var generation int64
		err := tx.QueryRowContext(ctx, `SELECT connection_id,generation FROM auth_attempts WHERE id=? AND status IN ('STARTING','IN_PROGRESS')`, attemptID).Scan(&connectionID, &generation)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE auth_attempts SET status=?,finished_at=? WHERE id=?`, status, now(), attemptID); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE connections SET state='AUTH_REQUIRED',generation=generation+1,updated_at=? WHERE id=? AND generation=?`, now(), connectionID, generation)
		return err
	})
}
