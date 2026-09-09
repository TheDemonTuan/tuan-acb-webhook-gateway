import type { DatabaseInstance } from './connection.js';
import { logger } from '../logger.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseInstance) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: '001_initial_schema',
    up: (db: DatabaseInstance) => {
      db.exec(`
        -- Gmail sync state
        CREATE TABLE IF NOT EXISTS gmail_state (
          mailbox_id TEXT PRIMARY KEY,
          last_history_id TEXT,
          watch_expiration_at INTEGER,
          updated_at TEXT NOT NULL
        );

        -- Ingested raw email records & verification
        CREATE TABLE IF NOT EXISTS source_messages (
          id TEXT PRIMARY KEY,
          mailbox_id TEXT NOT NULL,
          gmail_message_id TEXT NOT NULL UNIQUE,
          rfc_message_id TEXT,
          gmail_history_id TEXT,
          received_at TEXT,
          sender TEXT,
          subject TEXT,
          spf_status TEXT,
          dkim_status TEXT,
          dmarc_status TEXT,
          dkim_domain TEXT,
          parser_status TEXT NOT NULL, -- ACCEPTED, REJECTED, IGNORED, QUARANTINE
          parser_version TEXT,
          quarantine_reason TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_source_rfc_id ON source_messages(rfc_message_id);
        CREATE INDEX IF NOT EXISTS idx_source_parser_status ON source_messages(parser_status);

        -- Parsed bank transactions
        CREATE TABLE IF NOT EXISTS bank_transactions (
          id TEXT PRIMARY KEY,
          source_message_id TEXT NOT NULL REFERENCES source_messages(id),
          bank TEXT NOT NULL,
          direction TEXT NOT NULL, -- CREDIT, DEBIT
          amount TEXT NOT NULL, -- integer in VND as string
          currency TEXT NOT NULL DEFAULT 'VND',
          account_masked TEXT NOT NULL,
          description TEXT,
          transaction_at TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          status TEXT NOT NULL, -- CONFIRMED, QUARANTINED, IGNORED
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_txn_fingerprint ON bank_transactions(fingerprint);

        -- Canonical bank events for webhooks
        CREATE TABLE IF NOT EXISTS bank_events (
          id TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL REFERENCES bank_transactions(id),
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        -- Registered webhook destinations
        CREATE TABLE IF NOT EXISTS webhook_endpoints (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          secret_ciphertext TEXT NOT NULL,
          event_filter_json TEXT,
          timeout_ms INTEGER NOT NULL DEFAULT 10000,
          key_version TEXT NOT NULL DEFAULT 'v1',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        -- Durable outbox deliveries
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES bank_events(id),
          endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
          status TEXT NOT NULL, -- PENDING, IN_FLIGHT, RETRYING, DELIVERED, DEAD_LETTER
          attempt_count INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT NOT NULL,
          lease_owner TEXT,
          lease_until TEXT,
          last_http_status INTEGER,
          last_error TEXT,
          delivered_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(event_id, endpoint_id)
        );
        CREATE INDEX IF NOT EXISTS idx_deliveries_lease ON webhook_deliveries(status, lease_until, next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint ON webhook_deliveries(endpoint_id);

        -- Audit trail for operator actions & safety checks
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          details_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
      `);
    },
  },
  {
    version: 2,
    name: '002_gmail_oauth_connection',
    up: (db: DatabaseInstance) => {
      db.exec(`
        CREATE TABLE gmail_connection (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          email_address TEXT NOT NULL,
          token_ciphertext TEXT NOT NULL,
          client_id TEXT NOT NULL,
          connected_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE gmail_oauth_states (
          state_hash TEXT PRIMARY KEY,
          browser_nonce_hash TEXT NOT NULL,
          verifier_ciphertext TEXT NOT NULL,
          actor TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_gmail_oauth_states_expiry ON gmail_oauth_states(expires_at);
      `);
    },
  },
  {
    version: 3,
    name: '003_gmail_oauth_config',
    up: (db: DatabaseInstance) => {
      db.exec(`
        CREATE TABLE gmail_oauth_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          client_id TEXT NOT NULL,
          client_secret_ciphertext TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
];

export function runMigrations(db: DatabaseInstance): void {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      logger.info({ version: migration.version, name: migration.name }, 'Applying migration');
      
      const applyTx = db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
          migration.version,
          migration.name,
          new Date().toISOString()
        );
      });

      applyTx();
      logger.info({ version: migration.version, name: migration.name }, 'Migration applied successfully');
    }
  }
}
