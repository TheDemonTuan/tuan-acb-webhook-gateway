package storage

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
)

type TransactionView struct {
	ID            string `json:"id"`
	SemanticKey   string `json:"semanticKey"`
	TransactionAt string `json:"transactionDate"`
	EffectiveAt   string `json:"effectiveDate"`
	Debit         int64  `json:"debit"`
	Credit        int64  `json:"credit"`
	Balance       *int64 `json:"balance,omitempty"`
	Description   string `json:"description"`
	FirstSeenAt   string `json:"firstSeenAt"`
}

type DeliveryView struct {
	ID          string `json:"id"`
	EventID     string `json:"eventId"`
	EndpointID  string `json:"endpointId"`
	Status      string `json:"status"`
	Attempts    int    `json:"attempts"`
	NextAttempt string `json:"nextAttemptAt"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type AuditLogView struct {
	ID        string `json:"id"`
	Subject   string `json:"subject"`
	Role      string `json:"role"`
	Action    string `json:"action"`
	Target    string `json:"target"`
	CreatedAt string `json:"createdAt"`
}

type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"nextCursor,omitempty"`
}

func normalizePageSize(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 100 {
		return 100
	}
	return limit
}

func encodeCursor(sortValue, id string) string {
	if sortValue == "" || id == "" {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString([]byte(sortValue + "\x00" + id))
}

func decodeCursor(cursor string) (string, string, error) {
	if cursor == "" {
		return "", "", nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return "", "", errors.New("invalid pagination cursor")
	}
	parts := strings.Split(string(raw), "\x00")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", errors.New("invalid pagination cursor")
	}
	return parts[0], parts[1], nil
}

func (s *Store) ListTransactionsPage(ctx context.Context, limit int, cursor string) (Page[TransactionView], error) {
	limit = normalizePageSize(limit)
	sortValue, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return Page[TransactionView]{}, err
	}
	query := `SELECT id, semantic_key, transaction_date, effective_date, debit, credit, balance, COALESCE(CAST(description_envelope AS TEXT), ''), first_seen_at FROM transactions`
	args := []any{}
	if sortValue != "" {
		query += ` WHERE first_seen_at < ? OR (first_seen_at = ? AND id < ?)`
		args = append(args, sortValue, sortValue, cursorID)
	}
	query += ` ORDER BY first_seen_at DESC, id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return Page[TransactionView]{}, err
	}
	defer rows.Close()
	items := make([]TransactionView, 0, limit)
	for rows.Next() {
		var item TransactionView
		var description string
		if err := rows.Scan(&item.ID, &item.SemanticKey, &item.TransactionAt, &item.EffectiveAt, &item.Debit, &item.Credit, &item.Balance, &description, &item.FirstSeenAt); err != nil {
			return Page[TransactionView]{}, err
		}
		item.Description = description
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page[TransactionView]{}, err
	}
	page := Page[TransactionView]{Items: items}
	if len(items) > limit {
		last := items[limit-1]
		page.Items = items[:limit]
		page.NextCursor = encodeCursor(last.FirstSeenAt, last.ID)
	}
	return page, nil
}

func (s *Store) ListDeliveriesPage(ctx context.Context, limit int, cursor string) (Page[DeliveryView], error) {
	limit = normalizePageSize(limit)
	sortValue, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return Page[DeliveryView]{}, err
	}
	query := `SELECT id,event_id,endpoint_id,status,attempts,next_attempt_at,created_at,updated_at FROM deliveries`
	args := []any{}
	if sortValue != "" {
		query += ` WHERE created_at < ? OR (created_at = ? AND id < ?)`
		args = append(args, sortValue, sortValue, cursorID)
	}
	query += ` ORDER BY created_at DESC, id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return Page[DeliveryView]{}, err
	}
	defer rows.Close()
	items := make([]DeliveryView, 0, limit)
	for rows.Next() {
		var item DeliveryView
		if err := rows.Scan(&item.ID, &item.EventID, &item.EndpointID, &item.Status, &item.Attempts, &item.NextAttempt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return Page[DeliveryView]{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page[DeliveryView]{}, err
	}
	page := Page[DeliveryView]{Items: items}
	if len(items) > limit {
		last := items[limit-1]
		page.Items = items[:limit]
		page.NextCursor = encodeCursor(last.CreatedAt, last.ID)
	}
	return page, nil
}

func (s *Store) ListPollRunsPage(ctx context.Context, limit int, cursor string) (Page[PollRun], error) {
	limit = normalizePageSize(limit)
	sortValue, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return Page[PollRun]{}, err
	}
	query := `SELECT id,connection_id,generation,status,COALESCE(classifier,''),COALESCE(http_status,0),pages,rows_seen,COALESCE(sanitized_error,''),started_at,COALESCE(finished_at,'') FROM poll_runs`
	args := []any{}
	if sortValue != "" {
		query += ` WHERE started_at < ? OR (started_at = ? AND id < ?)`
		args = append(args, sortValue, sortValue, cursorID)
	}
	query += ` ORDER BY started_at DESC, id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return Page[PollRun]{}, err
	}
	defer rows.Close()
	items := make([]PollRun, 0, limit)
	for rows.Next() {
		var item PollRun
		if err := rows.Scan(&item.ID, &item.ConnectionID, &item.Generation, &item.Status, &item.Classifier, &item.HTTPStatus, &item.Pages, &item.RowsSeen, &item.Error, &item.StartedAt, &item.FinishedAt); err != nil {
			return Page[PollRun]{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page[PollRun]{}, err
	}
	page := Page[PollRun]{Items: items}
	if len(items) > limit {
		last := items[limit-1]
		page.Items = items[:limit]
		page.NextCursor = encodeCursor(last.StartedAt, last.ID)
	}
	return page, nil
}

func (s *Store) ListAuditLogsPage(ctx context.Context, limit int, cursor string) (Page[AuditLogView], error) {
	limit = normalizePageSize(limit)
	sortValue, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return Page[AuditLogView]{}, err
	}
	query := `SELECT id,COALESCE(actor_subject,''),COALESCE(actor_role,''),action,target,created_at FROM audit_logs`
	args := []any{}
	if sortValue != "" {
		query += ` WHERE created_at < ? OR (created_at = ? AND id < ?)`
		args = append(args, sortValue, sortValue, cursorID)
	}
	query += ` ORDER BY created_at DESC, id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return Page[AuditLogView]{}, err
	}
	defer rows.Close()
	items := make([]AuditLogView, 0, limit)
	for rows.Next() {
		var item AuditLogView
		if err := rows.Scan(&item.ID, &item.Subject, &item.Role, &item.Action, &item.Target, &item.CreatedAt); err != nil {
			return Page[AuditLogView]{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page[AuditLogView]{}, err
	}
	page := Page[AuditLogView]{Items: items}
	if len(items) > limit {
		last := items[limit-1]
		page.Items = items[:limit]
		page.NextCursor = encodeCursor(last.CreatedAt, last.ID)
	}
	return page, nil
}

func (s *Store) ListTransactions(ctx context.Context, limit int) ([]TransactionView, error) {
	page, err := s.ListTransactionsPage(ctx, limit, "")
	return page.Items, err
}

func (s *Store) ListDeliveries(ctx context.Context, limit int) ([]DeliveryView, error) {
	page, err := s.ListDeliveriesPage(ctx, limit, "")
	return page.Items, err
}

func (s *Store) ListPollRuns(ctx context.Context, limit int) ([]PollRun, error) {
	page, err := s.ListPollRunsPage(ctx, limit, "")
	return page.Items, err
}

func (s *Store) ListAuditLogs(ctx context.Context, limit int) ([]AuditLogView, error) {
	page, err := s.ListAuditLogsPage(ctx, limit, "")
	return page.Items, err
}

// CompleteAuthSession saves the verified session and transitions the connection to MONITORING.
func (s *Store) CompleteAuthSession(ctx context.Context, attemptID string, sessionEnvelope []byte) (Connection, error) {
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		var connectionID string
		var generation int64
		if err := tx.QueryRowContext(ctx, `SELECT connection_id,generation FROM auth_attempts WHERE id=? AND status IN ('STARTING','IN_PROGRESS')`, attemptID).Scan(&connectionID, &generation); err != nil {
			return err
		}
		nowString := now()
		if _, err := tx.ExecContext(ctx, `UPDATE auth_attempts SET status='VERIFIED',finished_at=? WHERE id=?`, nowString, attemptID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO sessions(connection_id,generation,envelope,key_id,verified_at,updated_at) VALUES(?,?,?,'k1',?,?) ON CONFLICT(connection_id) DO UPDATE SET generation=excluded.generation,envelope=excluded.envelope,verified_at=excluded.verified_at,updated_at=excluded.updated_at`, connectionID, generation, sessionEnvelope, nowString, nowString); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE connections SET state='MONITORING',updated_at=? WHERE id=? AND generation=? AND state='AUTH_STARTING'`, nowString, connectionID, generation)
		if err != nil {
			return err
		}
		changed, _ := result.RowsAffected()
		if changed != 1 {
			return sql.ErrNoRows
		}
		return nil
	})
	if err != nil {
		return Connection{}, err
	}
	return s.Connection(ctx)
}
