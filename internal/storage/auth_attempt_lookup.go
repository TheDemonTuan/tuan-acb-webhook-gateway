package storage

import (
	"context"
	"database/sql"
	"time"
)

func (s *Store) AuthAttemptForOwner(ctx context.Context, attemptID, owner string) (AuthAttempt, error) {
	var attempt AuthAttempt
	err := s.db.QueryRowContext(ctx, `
		SELECT id, connection_id, generation, status, expires_at, created_at
		FROM auth_attempts
		WHERE id=? AND owner_subject=? AND status IN ('STARTING','IN_PROGRESS') AND expires_at>?
	`, attemptID, owner, time.Now().UTC().Format(time.RFC3339Nano)).Scan(&attempt.ID, &attempt.ConnectionID, &attempt.Generation, &attempt.Status, &attempt.ExpiresAt, &attempt.CreatedAt)
	if err != nil {
		return AuthAttempt{}, err
	}
	return attempt, nil
}

func (s *Store) AuthAttemptStatusForOwner(ctx context.Context, attemptID, owner string) (AuthAttempt, error) {
	var attempt AuthAttempt
	err := s.db.QueryRowContext(ctx, `
		SELECT id, connection_id, generation, status, expires_at, created_at
		FROM auth_attempts
		WHERE id=? AND owner_subject=?
	`, attemptID, owner).Scan(&attempt.ID, &attempt.ConnectionID, &attempt.Generation, &attempt.Status, &attempt.ExpiresAt, &attempt.CreatedAt)
	if err != nil {
		return AuthAttempt{}, err
	}
	return attempt, nil
}

func IsNotFound(err error) bool { return err == sql.ErrNoRows }
