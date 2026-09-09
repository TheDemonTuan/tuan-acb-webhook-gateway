import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations.js';
import { Repository } from '../../src/db/repository.js';
import { WebhookDispatcher } from '../../src/webhook/dispatcher.js';
import { encryptSecret } from '../../src/crypto.js';
import { verifyIncomingWebhook } from '../../src/webhook/receiver.js';
import { loadConfig } from '../../src/config.js';
import crypto from 'node:crypto';
import * as ssrfGuard from '../../src/webhook/ssrf-guard.js';

describe('Webhook Dispatcher Flow', () => {
  let db: Database.Database;
  let repo: Repository;
  let dispatcher: WebhookDispatcher;
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const endpointSecret = 'whsec_consumer_test_secret_abc';
  let originalFetch: any;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = new Repository(db);
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_MASTER_KEY: masterKey,
    });
    dispatcher = new WebhookDispatcher(repo, config);
    originalFetch = global.fetch;

    // Mock SSRF validation so offline tests don't require external DNS queries
    vi.spyOn(ssrfGuard, 'validateWebhookUrl').mockResolvedValue({
      allowed: true,
      resolvedIp: '93.184.215.14',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    db.close();
  });

  it('dispatches webhook with valid HMAC and receiver verifies it successfully', async () => {
    const epId = 'ep_flow_1';
    const secretCiphertext = encryptSecret(endpointSecret, masterKey, epId);
    repo.addWebhookEndpoint({
      id: epId,
      name: 'Consumer API',
      url: 'https://example.com/webhooks/bank',
      secretCiphertext,
    });

    const sourceId = crypto.randomUUID();
    const eventId = 'evt_flow_1';
    const payload = {
      schemaVersion: 1,
      id: eventId,
      type: 'bank.credit.received',
      occurredAt: '2026-09-09T10:00:00.000Z',
      observedAt: '2026-09-09T10:00:05.000Z',
      source: 'gmail',
      bank: 'ACB',
      transaction: {
        id: 'txn_flow_1',
        direction: 'CREDIT',
        amount: '1500000',
        currency: 'VND',
        accountMasked: '123***789',
        description: 'Thanh toan hoa don test',
        transactionAt: '2026-09-09T10:00:00.000Z',
      },
    };

    repo.atomicSaveBankEvent({
      source: {
        id: sourceId,
        mailboxId: 'me',
        gmailMessageId: 'msg_flow_1',
        parserStatus: 'ACCEPTED',
        createdAt: new Date().toISOString(),
      },
      transaction: {
        id: 'txn_flow_1',
        sourceMessageId: sourceId,
        bank: 'ACB',
        direction: 'CREDIT',
        amount: '1500000',
        currency: 'VND',
        accountMasked: '123***789',
        transactionAt: '2026-09-09T10:00:00.000Z',
        fingerprint: 'fp_flow_1',
        status: 'CONFIRMED',
        createdAt: new Date().toISOString(),
      },
      event: {
        id: eventId,
        transactionId: 'txn_flow_1',
        eventType: 'bank.credit.received',
        payloadJson: JSON.stringify(payload),
        createdAt: new Date().toISOString(),
      },
    });

    // Mock fetch to simulate downstream consumer
    let capturedHeaders: any = {};
    let capturedBody = '';

    global.fetch = vi.fn().mockImplementation(async (url: any, init: any) => {
      capturedHeaders = init.headers;
      capturedBody = init.body;

      // Downstream receiver verifies incoming webhook
      const verifyResult = verifyIncomingWebhook({
        rawBody: capturedBody,
        headers: capturedHeaders,
        secret: endpointSecret,
      });

      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.payload?.transaction.amount).toBe('1500000');

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const processed = await dispatcher.processBatch();
    expect(processed).toBe(1);

    const metrics = repo.getQueueMetrics();
    expect(metrics.delivered).toBe(1);
    expect(metrics.pending).toBe(0);
  });
});
