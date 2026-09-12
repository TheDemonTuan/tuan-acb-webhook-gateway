package storage

import (
	"context"
	"database/sql"
	"errors"
)

type Checkpoint struct {
	ConnectionID string `json:"connectionId"`
	ScanID       string `json:"scanId"`
	CoverageFrom string `json:"coverageFrom"`
	CoverageTo   string `json:"coverageTo"`
	UpdatedAt    string `json:"updatedAt"`
}

func (s *Store) GetCheckpoint(ctx context.Context, connectionID string) (*Checkpoint, error) {
	var cp Checkpoint
	err := s.db.QueryRowContext(ctx, `
		SELECT connection_id, scan_id, coverage_from, coverage_to, updated_at
		FROM checkpoints WHERE connection_id = ?
	`, connectionID).Scan(&cp.ConnectionID, &cp.ScanID, &cp.CoverageFrom, &cp.CoverageTo, &cp.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &cp, nil
}

func (s *Store) SaveCheckpoint(ctx context.Context, cp Checkpoint) error {
	nowStr := now()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO checkpoints(connection_id, scan_id, coverage_from, coverage_to, updated_at)
		VALUES(?, ?, ?, ?, ?)
		ON CONFLICT(connection_id) DO UPDATE SET
			scan_id=excluded.scan_id,
			coverage_from=excluded.coverage_from,
			coverage_to=excluded.coverage_to,
			updated_at=excluded.updated_at
	`, cp.ConnectionID, cp.ScanID, cp.CoverageFrom, cp.CoverageTo, nowStr)
	return err
}
