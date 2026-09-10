package storage

import (
	"context"
	"database/sql"
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

func (s *Store) ListTransactions(ctx context.Context, limit int) ([]TransactionView, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, semantic_key, transaction_date, effective_date, debit, credit, balance, COALESCE(CAST(description_envelope AS TEXT), ''), first_seen_at
		FROM transactions
		ORDER BY first_seen_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []TransactionView
	for rows.Next() {
		var t TransactionView
		var desc string
		if err := rows.Scan(&t.ID, &t.SemanticKey, &t.TransactionAt, &t.EffectiveAt, &t.Debit, &t.Credit, &t.Balance, &desc, &t.FirstSeenAt); err != nil {
			return nil, err
		}
		t.Description = desc
		items = append(items, t)
	}
	if items == nil {
		items = []TransactionView{}
	}
	return items, rows.Err()
}

func (s *Store) ListDeliveries(ctx context.Context, limit int) ([]DeliveryView, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, event_id, endpoint_id, status, attempts, next_attempt_at, created_at, updated_at
		FROM deliveries
		ORDER BY updated_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []DeliveryView
	for rows.Next() {
		var d DeliveryView
		if err := rows.Scan(&d.ID, &d.EventID, &d.EndpointID, &d.Status, &d.Attempts, &d.NextAttempt, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, d)
	}
	if items == nil {
		items = []DeliveryView{}
	}
	return items, rows.Err()
}

func (s *Store) ListPollRuns(ctx context.Context, limit int) ([]PollRun, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, connection_id, generation, status, COALESCE(classifier, ''), COALESCE(http_status, 0), pages, rows_seen, COALESCE(sanitized_error, ''), started_at, COALESCE(finished_at, '')
		FROM poll_runs
		ORDER BY started_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []PollRun
	for rows.Next() {
		var p PollRun
		if err := rows.Scan(&p.ID, &p.ConnectionID, &p.Generation, &p.Status, &p.Classifier, &p.HTTPStatus, &p.Pages, &p.RowsSeen, &p.Error, &p.StartedAt, &p.FinishedAt); err != nil {
			return nil, err
		}
		items = append(items, p)
	}
	if items == nil {
		items = []PollRun{}
	}
	return items, rows.Err()
}

func (s *Store) ListAuditLogs(ctx context.Context, limit int) ([]AuditLogView, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, actor_subject, actor_role, action, target, created_at
		FROM audit_logs
		ORDER BY created_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []AuditLogView
	for rows.Next() {
		var a AuditLogView
		if err := rows.Scan(&a.ID, &a.Subject, &a.Role, &a.Action, &a.Target, &a.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, a)
	}
	if items == nil {
		items = []AuditLogView{}
	}
	return items, rows.Err()
}

// CompleteAuthSession saves the verified session and transitions the connection to MONITORING.
func (s *Store) CompleteAuthSession(ctx context.Context, attemptID string, sessionEnvelope []byte) (Connection, error) {
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		var connID string
		var gen int64
		err := tx.QueryRowContext(ctx, `SELECT connection_id, generation FROM auth_attempts WHERE id = ? AND status IN ('STARTING', 'IN_PROGRESS')`, attemptID).Scan(&connID, &gen)
		if err != nil {
			return err
		}

		nowStr := now()
		// Mark attempt finished
		_, err = tx.ExecContext(ctx, `UPDATE auth_attempts SET status='VERIFIED', finished_at=? WHERE id=?`, nowStr, attemptID)
		if err != nil {
			return err
		}

		// Insert or update session
		_, err = tx.ExecContext(ctx, `
			INSERT INTO sessions(connection_id, generation, envelope, key_id, verified_at, updated_at)
			VALUES(?, ?, ?, 'k1', ?, ?)
			ON CONFLICT(connection_id) DO UPDATE SET
				generation=excluded.generation,
				envelope=excluded.envelope,
				verified_at=excluded.verified_at,
				updated_at=excluded.updated_at
		`, connID, gen, sessionEnvelope, nowStr, nowStr)
		if err != nil {
			return err
		}

		// Transition connection to MONITORING only if this is still its active generation.
		res, err := tx.ExecContext(ctx, `UPDATE connections SET state='MONITORING', updated_at=? WHERE id=? AND generation=? AND state='AUTH_STARTING'`, nowStr, connID, gen)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return sql.ErrNoRows
		}
		return nil
	})
	if err != nil {
		return Connection{}, err
	}
	return s.Connection(ctx)
}
