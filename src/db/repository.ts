import type { DatabaseInstance } from './connection.js';
import crypto from 'node:crypto';

export interface GmailState {
  mailboxId: string;
  lastHistoryId?: string;
  watchExpirationAt?: number;
  updatedAt: string;
}

export interface GmailConnection {
  emailAddress: string;
  tokenCiphertext: string;
  clientId: string;
  connectedAt: string;
  updatedAt?: string;
}

export interface GmailOAuthState {
  stateHash: string;
  browserNonceHash: string;
  verifierCiphertext: string;
  actor: string;
  expiresAt: number;
}

export interface SourceMessageRecord {
  id: string;
  mailboxId: string;
  gmailMessageId: string;
  rfcMessageId?: string;
  gmailHistoryId?: string;
  receivedAt?: string;
  sender?: string;
  subject?: string;
  spfStatus?: string;
  dkimStatus?: string;
  dmarcStatus?: string;
  dkimDomain?: string;
  parserStatus: 'ACCEPTED' | 'REJECTED' | 'IGNORED' | 'QUARANTINE';
  parserVersion?: string;
  quarantineReason?: string;
  createdAt: string;
}

export interface BankTransactionRecord {
  id: string;
  sourceMessageId: string;
  bank: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: string; // positive integer string
  currency: string;
  accountMasked: string;
  description?: string;
  transactionAt: string;
  fingerprint: string;
  status: 'CONFIRMED' | 'QUARANTINED' | 'IGNORED';
  createdAt: string;
}

export interface BankEventRecord {
  id: string;
  transactionId: string;
  eventType: string;
  payloadJson: string;
  createdAt: string;
}

export interface WebhookEndpointRecord {
  id: string;
  name: string;
  url: string;
  enabled: number;
  secretCiphertext: string;
  eventFilterJson?: string;
  timeoutMs: number;
  keyVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  eventId: string;
  endpointId: string;
  status: 'PENDING' | 'IN_FLIGHT' | 'RETRYING' | 'DELIVERED' | 'DEAD_LETTER';
  attemptCount: number;
  nextAttemptAt: string;
  leaseOwner?: string;
  leaseUntil?: string;
  lastHttpStatus?: number;
  lastError?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class Repository {
  constructor(private db: DatabaseInstance) {}

  // ================= Gmail State =================
  getGmailState(mailboxId: string): GmailState | null {
    const row = this.db
      .prepare('SELECT mailbox_id, last_history_id, watch_expiration_at, updated_at FROM gmail_state WHERE mailbox_id = ?')
      .get(mailboxId) as any;
    if (!row) return null;
    return {
      mailboxId: row.mailbox_id,
      lastHistoryId: row.last_history_id,
      watchExpirationAt: row.watch_expiration_at,
      updatedAt: row.updated_at,
    };
  }

  setGmailState(state: GmailState): void {
    this.db
      .prepare(`
        INSERT INTO gmail_state (mailbox_id, last_history_id, watch_expiration_at, updated_at)
        VALUES (@mailboxId, @lastHistoryId, @watchExpirationAt, @updatedAt)
        ON CONFLICT(mailbox_id) DO UPDATE SET
          last_history_id = excluded.last_history_id,
          watch_expiration_at = excluded.watch_expiration_at,
          updated_at = excluded.updated_at
      `)
      .run({
        mailboxId: state.mailboxId,
        lastHistoryId: state.lastHistoryId || null,
        watchExpirationAt: state.watchExpirationAt || null,
        updatedAt: state.updatedAt,
      });
  }

  // ================= Gmail OAuth Connection =================
  getGmailConnection(): GmailConnection | null {
    const row = this.db.prepare('SELECT * FROM gmail_connection WHERE id = 1').get() as any;
    if (!row) return null;
    return {
      emailAddress: row.email_address,
      tokenCiphertext: row.token_ciphertext,
      clientId: row.client_id,
      connectedAt: row.connected_at,
      updatedAt: row.updated_at,
    };
  }

  saveGmailConnection(connection: GmailConnection): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO gmail_connection (id, email_address, token_ciphertext, client_id, connected_at, updated_at)
      VALUES (1, @emailAddress, @tokenCiphertext, @clientId, @connectedAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        email_address = excluded.email_address,
        token_ciphertext = excluded.token_ciphertext,
        client_id = excluded.client_id,
        connected_at = excluded.connected_at,
        updated_at = excluded.updated_at
    `).run({ ...connection, updatedAt: now });
  }

  deleteGmailConnection(): void {
    this.db.prepare('DELETE FROM gmail_connection WHERE id = 1').run();
  }

  createGmailOAuthState(state: GmailOAuthState): void {
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM gmail_oauth_states WHERE browser_nonce_hash = ? OR expires_at < ?').run(state.browserNonceHash, Date.now());
      this.db.prepare(`
        INSERT INTO gmail_oauth_states (state_hash, browser_nonce_hash, verifier_ciphertext, actor, expires_at, created_at)
        VALUES (@stateHash, @browserNonceHash, @verifierCiphertext, @actor, @expiresAt, @createdAt)
      `).run({ ...state, createdAt: now });
    });
    transaction();
  }

  consumeGmailOAuthState(stateHash: string, browserNonceHash: string, now: number): GmailOAuthState | null {
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare(`
        DELETE FROM gmail_oauth_states
        WHERE state_hash = ? AND browser_nonce_hash = ? AND expires_at >= ?
        RETURNING state_hash, browser_nonce_hash, verifier_ciphertext, actor, expires_at
      `).get(stateHash, browserNonceHash, now) as any;
      return row ? {
        stateHash: row.state_hash,
        browserNonceHash: row.browser_nonce_hash,
        verifierCiphertext: row.verifier_ciphertext,
        actor: row.actor,
        expiresAt: row.expires_at,
      } : null;
    });
    return transaction();
  }

  clearGmailOAuthStates(): void {
    this.db.prepare('DELETE FROM gmail_oauth_states').run();
  }

  // ================= Source Messages =================
  getSourceMessageByGmailId(gmailMessageId: string): SourceMessageRecord | null {
    const row = this.db
      .prepare('SELECT * FROM source_messages WHERE gmail_message_id = ?')
      .get(gmailMessageId) as any;
    if (!row) return null;
    return this.mapSourceMessage(row);
  }

  saveSourceMessage(msg: SourceMessageRecord): void {
    this.db
      .prepare(`
        INSERT INTO source_messages (
          id, mailbox_id, gmail_message_id, rfc_message_id, gmail_history_id,
          received_at, sender, subject, spf_status, dkim_status, dmarc_status,
          dkim_domain, parser_status, parser_version, quarantine_reason, created_at
        ) VALUES (
          @id, @mailboxId, @gmailMessageId, @rfcMessageId, @gmailHistoryId,
          @receivedAt, @sender, @subject, @spfStatus, @dkimStatus, @dmarcStatus,
          @dkimDomain, @parserStatus, @parserVersion, @quarantineReason, @createdAt
        )
      `)
      .run({
        id: msg.id,
        mailboxId: msg.mailboxId,
        gmailMessageId: msg.gmailMessageId,
        rfcMessageId: msg.rfcMessageId ?? null,
        gmailHistoryId: msg.gmailHistoryId ?? null,
        receivedAt: msg.receivedAt ?? null,
        sender: msg.sender ?? null,
        subject: msg.subject ?? null,
        spfStatus: msg.spfStatus ?? null,
        dkimStatus: msg.dkimStatus ?? null,
        dmarcStatus: msg.dmarcStatus ?? null,
        dkimDomain: msg.dkimDomain ?? null,
        parserStatus: msg.parserStatus,
        parserVersion: msg.parserVersion ?? null,
        quarantineReason: msg.quarantineReason ?? null,
        createdAt: msg.createdAt,
      });
  }

  // ================= Transactions & Events =================
  findTransactionByFingerprint(fingerprint: string): BankTransactionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM bank_transactions WHERE fingerprint = ?')
      .get(fingerprint) as any;
    if (!row) return null;
    return this.mapBankTransaction(row);
  }

  /**
   * Atomic commit of source message, transaction, bank event, and outbox deliveries
   */
  atomicSaveBankEvent(params: {
    source: SourceMessageRecord;
    transaction: BankTransactionRecord;
    event: BankEventRecord;
  }): { deliveriesCount: number } {
    const saveTx = this.db.transaction(() => {
      // 1. Insert source message
      this.db
        .prepare(`
          INSERT INTO source_messages (
            id, mailbox_id, gmail_message_id, rfc_message_id, gmail_history_id,
            received_at, sender, subject, spf_status, dkim_status, dmarc_status,
            dkim_domain, parser_status, parser_version, quarantine_reason, created_at
          ) VALUES (
            @id, @mailboxId, @gmailMessageId, @rfcMessageId, @gmailHistoryId,
            @receivedAt, @sender, @subject, @spfStatus, @dkimStatus, @dmarcStatus,
            @dkimDomain, @parserStatus, @parserVersion, @quarantineReason, @createdAt
          )
        `)
        .run({
          id: params.source.id,
          mailboxId: params.source.mailboxId,
          gmailMessageId: params.source.gmailMessageId,
          rfcMessageId: params.source.rfcMessageId ?? null,
          gmailHistoryId: params.source.gmailHistoryId ?? null,
          receivedAt: params.source.receivedAt ?? null,
          sender: params.source.sender ?? null,
          subject: params.source.subject ?? null,
          spfStatus: params.source.spfStatus ?? null,
          dkimStatus: params.source.dkimStatus ?? null,
          dmarcStatus: params.source.dmarcStatus ?? null,
          dkimDomain: params.source.dkimDomain ?? null,
          parserStatus: params.source.parserStatus,
          parserVersion: params.source.parserVersion ?? null,
          quarantineReason: params.source.quarantineReason ?? null,
          createdAt: params.source.createdAt,
        });

      // 2. Insert bank transaction
      this.db
        .prepare(`
          INSERT INTO bank_transactions (
            id, source_message_id, bank, direction, amount, currency,
            account_masked, description, transaction_at, fingerprint, status, created_at
          ) VALUES (
            @id, @sourceMessageId, @bank, @direction, @amount, @currency,
            @accountMasked, @description, @transactionAt, @fingerprint, @status, @createdAt
          )
        `)
        .run({
          id: params.transaction.id,
          sourceMessageId: params.transaction.sourceMessageId,
          bank: params.transaction.bank,
          direction: params.transaction.direction,
          amount: params.transaction.amount,
          currency: params.transaction.currency ?? 'VND',
          accountMasked: params.transaction.accountMasked,
          description: params.transaction.description ?? null,
          transactionAt: params.transaction.transactionAt,
          fingerprint: params.transaction.fingerprint,
          status: params.transaction.status,
          createdAt: params.transaction.createdAt,
        });

      // 3. Insert bank event
      this.db
        .prepare(`
          INSERT INTO bank_events (id, transaction_id, event_type, payload_json, created_at)
          VALUES (@id, @transactionId, @eventType, @payloadJson, @createdAt)
        `)
        .run(params.event);

      // 4. Query active endpoints matching event type
      const activeEndpoints = this.db
        .prepare('SELECT id, event_filter_json FROM webhook_endpoints WHERE enabled = 1')
        .all() as { id: string; event_filter_json: string | null }[];

      let count = 0;
      const nowIso = new Date().toISOString();

      const insertDeliveryStmt = this.db.prepare(`
        INSERT INTO webhook_deliveries (
          id, event_id, endpoint_id, status, attempt_count, next_attempt_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'PENDING', 0, ?, ?, ?)
      `);

      for (const endpoint of activeEndpoints) {
        let matches = true;
        if (endpoint.event_filter_json) {
          try {
            const filter = JSON.parse(endpoint.event_filter_json) as string[];
            if (Array.isArray(filter) && filter.length > 0 && !filter.includes(params.event.eventType)) {
              matches = false;
            }
          } catch {
            matches = true;
          }
        }

        if (matches) {
          const deliveryId = crypto.randomUUID();
          insertDeliveryStmt.run(deliveryId, params.event.id, endpoint.id, nowIso, nowIso, nowIso);
          count++;
        }
      }

      return { deliveriesCount: count };
    });

    return saveTx();
  }

  // ================= Webhook Deliveries (Outbox) =================
  claimPendingDeliveries(
    leaseOwner: string,
    leaseSeconds: number,
    limit: number
  ): Array<WebhookDeliveryRecord & { payloadJson: string; endpointUrl: string; secretCiphertext: string; timeoutMs: number; keyVersion: string }> {
    const claimTx = this.db.transaction(() => {
      const nowIso = new Date().toISOString();
      const leaseUntilIso = new Date(Date.now() + leaseSeconds * 1000).toISOString();

      // Find pending deliveries whose next_attempt_at <= now AND (status = 'PENDING' OR lease_until <= now)
      const candidateRows = this.db
        .prepare(`
          SELECT d.id
          FROM webhook_deliveries d
          JOIN webhook_endpoints e ON d.endpoint_id = e.id
          WHERE e.enabled = 1
            AND (d.status = 'PENDING' OR (d.status IN ('IN_FLIGHT', 'RETRYING') AND d.lease_until <= ?))
            AND d.next_attempt_at <= ?
          ORDER BY d.next_attempt_at ASC
          LIMIT ?
        `)
        .all(nowIso, nowIso, limit) as { id: string }[];

      if (candidateRows.length === 0) return [];

      const ids = candidateRows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');

      // Lock them with lease_owner and lease_until
      this.db
        .prepare(`
          UPDATE webhook_deliveries
          SET status = 'IN_FLIGHT',
              lease_owner = ?,
              lease_until = ?,
              updated_at = ?
          WHERE id IN (${placeholders})
        `)
        .run(leaseOwner, leaseUntilIso, nowIso, ...ids);

      // Fetch the full details
      const claimedRows = this.db
        .prepare(`
          SELECT d.*, ev.payload_json, ep.url AS endpoint_url, ep.secret_ciphertext, ep.timeout_ms, ep.key_version
          FROM webhook_deliveries d
          JOIN bank_events ev ON d.event_id = ev.id
          JOIN webhook_endpoints ep ON d.endpoint_id = ep.id
          WHERE d.id IN (${placeholders})
        `)
        .all(...ids) as any[];

      return claimedRows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        endpointId: row.endpoint_id,
        status: row.status,
        attemptCount: row.attempt_count,
        nextAttemptAt: row.next_attempt_at,
        leaseOwner: row.lease_owner,
        leaseUntil: row.lease_until,
        lastHttpStatus: row.last_http_status,
        lastError: row.last_error,
        deliveredAt: row.delivered_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        payloadJson: row.payload_json,
        endpointUrl: row.endpoint_url,
        secretCiphertext: row.secret_ciphertext,
        timeoutMs: row.timeout_ms,
        keyVersion: row.key_version,
      }));
    });

    return claimTx();
  }

  markDeliverySuccess(id: string, httpStatus: number): void {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE webhook_deliveries
        SET status = 'DELIVERED',
            last_http_status = ?,
            last_error = NULL,
            delivered_at = ?,
            lease_owner = NULL,
            lease_until = NULL,
            updated_at = ?
        WHERE id = ?
      `)
      .run(httpStatus, nowIso, nowIso, id);
  }

  markDeliveryFailure(params: {
    id: string;
    httpStatus?: number;
    error: string;
    nextAttemptAt: string;
    isDeadLetter: boolean;
  }): void {
    const nowIso = new Date().toISOString();
    const newStatus = params.isDeadLetter ? 'DEAD_LETTER' : 'RETRYING';

    this.db
      .prepare(`
        UPDATE webhook_deliveries
        SET status = ?,
            attempt_count = attempt_count + 1,
            last_http_status = ?,
            last_error = ?,
            next_attempt_at = ?,
            lease_owner = NULL,
            lease_until = NULL,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        newStatus,
        params.httpStatus ?? null,
        params.error,
        params.nextAttemptAt,
        nowIso,
        params.id
      );
  }

  // ================= Webhook Endpoints Management =================
  addWebhookEndpoint(endpoint: {
    id: string;
    name: string;
    url: string;
    secretCiphertext: string;
    eventFilterJson?: string;
    timeoutMs?: number;
    keyVersion?: string;
  }): void {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO webhook_endpoints (
          id, name, url, enabled, secret_ciphertext, event_filter_json, timeout_ms, key_version, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        endpoint.id,
        endpoint.name,
        endpoint.url,
        endpoint.secretCiphertext,
        endpoint.eventFilterJson ?? null,
        endpoint.timeoutMs ?? 10000,
        endpoint.keyVersion ?? 'v1',
        nowIso,
        nowIso
      );
  }

  getEndpointById(id: string): WebhookEndpointRecord | null {
    const row = this.db.prepare('SELECT * FROM webhook_endpoints WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapWebhookEndpoint(row);
  }

  listWebhookEndpoints(): WebhookEndpointRecord[] {
    const rows = this.db.prepare('SELECT * FROM webhook_endpoints ORDER BY created_at ASC').all() as any[];
    return rows.map(this.mapWebhookEndpoint);
  }

  toggleWebhookEndpoint(id: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE webhook_endpoints SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id);
  }

  deleteWebhookEndpoint(id: string): void {
    const delTx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM webhook_deliveries WHERE endpoint_id = ?').run(id);
      this.db.prepare('DELETE FROM webhook_endpoints WHERE id = ?').run(id);
    });
    delTx();
  }

  listRecentEvents(limit = 50): Array<{
    id: string;
    eventType: string;
    amount: string;
    accountMasked: string;
    description: string | null;
    transactionAt: string;
    status: string;
    createdAt: string;
  }> {
    return this.db
      .prepare(`
        SELECT e.id, e.event_type as eventType, t.amount, t.account_masked as accountMasked,
               t.description, t.transaction_at as transactionAt, t.status, e.created_at as createdAt
        FROM bank_events e
        JOIN bank_transactions t ON e.transaction_id = t.id
        ORDER BY e.created_at DESC
        LIMIT ?
      `)
      .all(limit) as any[];
  }

  listRecentDeliveries(limit = 50): Array<{
    id: string;
    eventId: string;
    endpointName: string;
    endpointUrl: string;
    status: string;
    attemptCount: number;
    nextAttemptAt: string;
    lastHttpStatus: number | null;
    lastError: string | null;
    deliveredAt: string | null;
    createdAt: string;
  }> {
    return this.db
      .prepare(`
        SELECT d.id, d.event_id as eventId, ep.name as endpointName, ep.url as endpointUrl,
               d.status, d.attempt_count as attemptCount, d.next_attempt_at as nextAttemptAt,
               d.last_http_status as lastHttpStatus, d.last_error as lastError,
               d.delivered_at as deliveredAt, d.created_at as createdAt
        FROM webhook_deliveries d
        JOIN webhook_endpoints ep ON d.endpoint_id = ep.id
        ORDER BY d.created_at DESC
        LIMIT ?
      `)
      .all(limit) as any[];
  }

  listRecentAuditLogs(limit = 50): Array<{
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    actor: string;
    detailsJson: string | null;
    createdAt: string;
  }> {
    return this.db
      .prepare(`
        SELECT id, entity_type as entityType, entity_id as entityId, action, actor,
               details_json as detailsJson, created_at as createdAt
        FROM audit_logs
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(limit) as any[];
  }

  // ================= Audit Logging =================
  logAudit(log: {
    entityType: string;
    entityId: string;
    action: string;
    actor: string;
    detailsJson?: string;
  }): void {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO audit_logs (id, entity_type, entity_id, action, actor, details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, log.entityType, log.entityId, log.action, log.actor, log.detailsJson ?? null, nowIso);
  }

  // ================= Queue Metrics =================
  getQueueMetrics(): {
    pending: number;
    inFlight: number;
    retrying: number;
    delivered: number;
    deadLetter: number;
  } {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM webhook_deliveries GROUP BY status')
      .all() as { status: string; count: number }[];

    const metrics = {
      pending: 0,
      inFlight: 0,
      retrying: 0,
      delivered: 0,
      deadLetter: 0,
    };

    for (const r of rows) {
      if (r.status === 'PENDING') metrics.pending = r.count;
      else if (r.status === 'IN_FLIGHT') metrics.inFlight = r.count;
      else if (r.status === 'RETRYING') metrics.retrying = r.count;
      else if (r.status === 'DELIVERED') metrics.delivered = r.count;
      else if (r.status === 'DEAD_LETTER') metrics.deadLetter = r.count;
    }

    return metrics;
  }

  // ================= Mapping Helpers =================
  private mapSourceMessage(row: any): SourceMessageRecord {
    return {
      id: row.id,
      mailboxId: row.mailbox_id,
      gmailMessageId: row.gmail_message_id,
      rfcMessageId: row.rfc_message_id,
      gmailHistoryId: row.gmail_history_id,
      receivedAt: row.received_at,
      sender: row.sender,
      subject: row.subject,
      spfStatus: row.spf_status,
      dkimStatus: row.dkim_status,
      dmarcStatus: row.dmarc_status,
      dkimDomain: row.dkim_domain,
      parserStatus: row.parser_status,
      parserVersion: row.parser_version,
      quarantineReason: row.quarantine_reason,
      createdAt: row.created_at,
    };
  }

  private mapBankTransaction(row: any): BankTransactionRecord {
    return {
      id: row.id,
      sourceMessageId: row.source_message_id,
      bank: row.bank,
      direction: row.direction,
      amount: row.amount,
      currency: row.currency,
      accountMasked: row.account_masked,
      description: row.description,
      transactionAt: row.transaction_at,
      fingerprint: row.fingerprint,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  private mapWebhookEndpoint(row: any): WebhookEndpointRecord {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      enabled: row.enabled,
      secretCiphertext: row.secret_ciphertext,
      eventFilterJson: row.event_filter_json,
      timeoutMs: row.timeout_ms,
      keyVersion: row.key_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
