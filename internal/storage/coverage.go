package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/thedemontuan/acb-transaction-webhook/internal/acb"
)

type CoverageRecord struct {
	Day        string
	Status     string
	LastSyncAt string
	RowsSeen   int
}

// CheckRangeCoverage checks if every day in [fromDay, toDay] is covered and fresh.
func (s *Store) CheckRangeCoverage(ctx context.Context, connectionID string, fromDay, toDay string) (bool, error) {
	fromT, err := time.Parse("2006-01-02", fromDay)
	if err != nil {
		return false, err
	}
	toT, err := time.Parse("2006-01-02", toDay)
	if err != nil {
		return false, err
	}
	if fromT.After(toT) {
		return false, errors.New("from date must not be after to date")
	}

	now := time.Now().In(acb.DefaultLocation)
	todayStr := now.Format("2006-01-02")
	yesterdayStr := now.AddDate(0, 0, -1).Format("2006-01-02")

	for cur := fromT; !cur.After(toT); cur = cur.AddDate(0, 0, 1) {
		curStr := cur.Format("2006-01-02")

		var status, lastSyncAtStr string
		err := s.db.QueryRowContext(ctx, `
			SELECT status, last_sync_at 
			FROM history_coverage 
			WHERE connection_id = ? AND day = ?
		`, connectionID, curStr).Scan(&status, &lastSyncAtStr)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return false, nil // missing day
			}
			return false, err
		}

		if status != "COMPLETE" {
			return false, nil
		}

		// TTL check
		syncTime, err := time.Parse(time.RFC3339Nano, lastSyncAtStr)
		if err != nil {
			syncTime, err = time.Parse(time.RFC3339, lastSyncAtStr)
		}
		if err != nil {
			return false, nil // unparseable sync time, treat as stale
		}

		age := now.Sub(syncTime)
		if curStr == todayStr {
			if age > 30*time.Second {
				return false, nil // today's coverage expires in 30s
			}
		} else if curStr == yesterdayStr {
			if age > 2*time.Hour {
				return false, nil // yesterday's coverage expires in 2h
			}
		} else {
			if age > 24*time.Hour {
				return false, nil // older history expires in 24h
			}
		}
	}

	return true, nil
}

// RecordCoverage records successful sync coverage for a list of days.
func (s *Store) RecordCoverage(ctx context.Context, connectionID string, days []string, rowsSeen int) error {
	if connectionID == "" || len(days) == 0 {
		return nil
	}
	nowStr := time.Now().UTC().Format(time.RFC3339Nano)
	return s.withTx(ctx, func(tx *sql.Tx) error {
		for _, day := range days {
			recID := id("cov")
			_, err := tx.ExecContext(ctx, `
				INSERT INTO history_coverage(id, connection_id, day, status, last_sync_at, rows_seen)
				VALUES(?, ?, ?, 'COMPLETE', ?, ?)
				ON CONFLICT(connection_id, day) DO UPDATE SET
					status = 'COMPLETE',
					last_sync_at = excluded.last_sync_at,
					rows_seen = excluded.rows_seen
			`, recID, connectionID, day, nowStr, rowsSeen)
			if err != nil {
				return err
			}
		}
		return nil
	})
}
