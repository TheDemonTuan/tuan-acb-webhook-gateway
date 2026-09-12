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

func (s *Store) MarkAuthAttemptInProgress(ctx context.Context, attemptID string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE auth_attempts SET status='IN_PROGRESS'
		WHERE id=? AND status='STARTING' AND EXISTS (
			SELECT 1 FROM connections c WHERE c.id=auth_attempts.connection_id
			AND c.generation=auth_attempts.generation AND c.state='AUTH_STARTING'
		)`, attemptID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed != 1 {
		return sql.ErrNoRows
	}
	return nil
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
		result, err := tx.ExecContext(ctx, `UPDATE connections SET state='AUTH_REQUIRED',generation=generation+1,updated_at=? WHERE id=? AND generation=?`, now(), connectionID, generation)
		if err != nil {
			return err
		}
		if _, err := result.RowsAffected(); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE auth_attempts SET status=?,finished_at=? WHERE id=?`, status, now(), attemptID)
		return err
	})
}

// HasActiveAuthAttempt checks whether an interactive browser authentication attempt
// is currently active and unexpired for the specified connection.
func (s *Store) HasActiveAuthAttempt(ctx context.Context, connectionID string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT count(*) FROM auth_attempts
		WHERE connection_id = ? AND status IN ('STARTING', 'IN_PROGRESS', 'EXPORTING', 'VERIFYING') AND expires_at > ?
	`, connectionID, now()).Scan(&count)
	return count > 0, err
}
