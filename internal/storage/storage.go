package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

func Open(ctx context.Context, path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(0)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db}
	if err := s.Migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) DB() *sql.DB  { return s.db }
func (s *Store) Migrate(ctx context.Context) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`); err != nil {
			return err
		}
		for _, m := range migrations {
			var checksum string
			err := tx.QueryRowContext(ctx, `SELECT checksum FROM schema_migrations WHERE version = ?`, m.version).Scan(&checksum)
			if errors.Is(err, sql.ErrNoRows) {
				if _, err := tx.ExecContext(ctx, m.sql); err != nil {
					return fmt.Errorf("migration %d: %w", m.version, err)
				}
				if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version, checksum, applied_at) VALUES(?,?,?)`, m.version, m.checksum, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else if checksum != m.checksum {
				return fmt.Errorf("migration %d checksum mismatch", m.version)
			}
		}
		return nil
	})
}
func (s *Store) withTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return err
	}
	if err = fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
func (s *Store) Health(ctx context.Context) error { return s.db.PingContext(ctx) }

type migration struct {
	version       int
	checksum, sql string
}

var migrations = []migration{{1, "2026-09-10-v2-foundation", `
CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, bank_code TEXT NOT NULL DEFAULT 'ACB', account_identity_hmac TEXT UNIQUE, account_envelope BLOB, account_masked TEXT, state TEXT NOT NULL DEFAULT 'UNCONFIGURED', generation INTEGER NOT NULL DEFAULT 0, config_revision INTEGER NOT NULL DEFAULT 0, started_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (connection_id TEXT PRIMARY KEY REFERENCES connections(id), generation INTEGER NOT NULL, envelope BLOB NOT NULL, key_id TEXT NOT NULL, verified_at TEXT, expires_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_attempts (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id), generation INTEGER NOT NULL, owner_subject TEXT, status TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_auth_attempt ON auth_attempts(connection_id) WHERE status IN ('STARTING','IN_PROGRESS','EXPORTING','VERIFYING');
CREATE TABLE IF NOT EXISTS poll_runs (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id), generation INTEGER NOT NULL, status TEXT NOT NULL, classifier TEXT, http_status INTEGER, pages INTEGER NOT NULL DEFAULT 0, rows_seen INTEGER NOT NULL DEFAULT 0, sanitized_error TEXT, started_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS checkpoints (connection_id TEXT PRIMARY KEY REFERENCES connections(id), scan_id TEXT, coverage_from TEXT, coverage_to TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coverage_gaps (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id), coverage_from TEXT NOT NULL, coverage_to TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id), semantic_key TEXT NOT NULL, canonical_hash TEXT NOT NULL, transaction_date TEXT NOT NULL, effective_date TEXT NOT NULL, debit INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0, balance INTEGER, description_envelope BLOB, parser_version TEXT NOT NULL, baseline_state TEXT NOT NULL DEFAULT 'NONE', first_seen_at TEXT NOT NULL, UNIQUE(connection_id,semantic_key));
CREATE TABLE IF NOT EXISTS transaction_quarantine (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id), semantic_key TEXT NOT NULL, existing_hash TEXT, candidate_envelope BLOB NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS dedupe_keys (semantic_key TEXT PRIMARY KEY, canonical_hash TEXT NOT NULL, event_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, transaction_id TEXT REFERENCES transactions(id), event_type TEXT NOT NULL, payload BLOB NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(transaction_id,event_type));
CREATE TABLE IF NOT EXISTS webhook_endpoints (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, current_revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS endpoint_versions (endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id), revision INTEGER NOT NULL, url TEXT NOT NULL, filters_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(endpoint_id,revision));
CREATE TABLE IF NOT EXISTS endpoint_secrets (endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id), key_id TEXT NOT NULL, envelope BLOB NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, retired_at TEXT, PRIMARY KEY(endpoint_id,key_id));
CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), endpoint_id TEXT NOT NULL, endpoint_revision INTEGER NOT NULL, key_id TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, claim_token TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(event_id,endpoint_id));
CREATE TABLE IF NOT EXISTS delivery_attempts (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id), attempt_number INTEGER NOT NULL, status_code INTEGER, latency_ms INTEGER, outcome TEXT NOT NULL, sanitized_error TEXT, created_at TEXT NOT NULL, UNIQUE(delivery_id,attempt_number));
CREATE TABLE IF NOT EXISTS system_events (id TEXT PRIMARY KEY, incident_key TEXT NOT NULL, event_type TEXT NOT NULL, state TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_subject TEXT, actor_role TEXT, action TEXT NOT NULL, target TEXT NOT NULL, request_id TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
`}, {2, "2026-09-10-v2-hot-indexes", `
CREATE INDEX IF NOT EXISTS idx_transactions_connection_date ON transactions(connection_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_due ON deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_poll_runs_connection_started ON poll_runs(connection_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
`}}
