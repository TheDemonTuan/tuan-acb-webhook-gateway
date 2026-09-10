package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type TransactionInput struct {
	ConnectionID  string
	SemanticKey   string
	CanonicalHash string
	TransactionAt string
	EffectiveAt   string
	Debit         int64
	Credit        int64
	Balance       *int64
	Description   []byte
	ParserVersion string
}

type IngestResult struct {
	TransactionID string
	Inserted      bool
	Conflict      bool
}

// IngestTransaction preserves the first observation. A distinct payload for an
// existing semantic key is quarantined instead of silently replacing money data.
func (s *Store) IngestTransaction(ctx context.Context, in TransactionInput) (IngestResult, error) {
	if in.ConnectionID == "" || in.SemanticKey == "" || in.CanonicalHash == "" || in.TransactionAt == "" || in.EffectiveAt == "" || in.ParserVersion == "" {
		return IngestResult{}, errors.New("incomplete transaction")
	}
	result := IngestResult{}
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		var existingID, existingHash string
		err := tx.QueryRowContext(ctx, `SELECT id,canonical_hash FROM transactions WHERE connection_id=? AND semantic_key=?`, in.ConnectionID, in.SemanticKey).Scan(&existingID, &existingHash)
		if err == nil {
			result.TransactionID = existingID
			if existingHash != in.CanonicalHash {
				result.Conflict = true
				candidate := in.Description
				if candidate == nil {
					candidate = []byte{}
				}
				_, err = tx.ExecContext(ctx, `INSERT INTO transaction_quarantine(id,connection_id,semantic_key,existing_hash,candidate_envelope,reason,created_at) VALUES(?,?,?,?,?,?,?)`, id("quarantine"), in.ConnectionID, in.SemanticKey, existingHash, candidate, "CANONICAL_HASH_MISMATCH", now())
			}
			return err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		result.TransactionID = id("txn")
		_, err = tx.ExecContext(ctx, `INSERT INTO transactions(id,connection_id,semantic_key,canonical_hash,transaction_date,effective_date,debit,credit,balance,description_envelope,parser_version,first_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, result.TransactionID, in.ConnectionID, in.SemanticKey, in.CanonicalHash, in.TransactionAt, in.EffectiveAt, in.Debit, in.Credit, in.Balance, in.Description, in.ParserVersion, now())
		if err == nil {
			result.Inserted = true
		}
		return err
	})
	if err != nil {
		return IngestResult{}, fmt.Errorf("ingest transaction: %w", err)
	}
	return result, nil
}
