import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations.js';
import { Repository } from '../../src/db/repository.js';
import { encryptSecret } from '../../src/crypto.js';
import crypto from 'node:crypto';

describe('Repository & SQLite WAL Integration', () => {
  let db: Database.Database;
  let repo: Repository;
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = new Repository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('manages Gmail sync state correctly', () => {
    expect(repo.getGmailState('me')).toBeNull();

    repo.setGmailState({
      mailboxId: 'me',
      lastHistoryId: '123456',
      watchExpirationAt: 1770000000000,
      updatedAt: new Date().toISOString(),
    });

    const state = repo.getGmailState('me');
    expect(state).not.toBeNull();
    expect(state?.lastHistoryId).toBe('123456');
    expect(state?.watchExpirationAt).toBe(1770000000000);
  });

  it('atomically saves source message, transaction, bank event, and outbox delivery', () => {
    // 1. Add an active webhook endpoint first
    const epId = 'ep_test_1';
    const secretCiphertext = encryptSecret('whsec_test_secret', masterKey, epId);
    repo.addWebhookEndpoint({
      id: epId,
      name: 'Test Endpoint',
      url: 'https://webhook.site/test',
      secretCiphertext,
      eventFilterJson: JSON.stringify(['bank.credit.received']),
    });

    // 2. Perform atomic save
    const sourceId = crypto.randomUUID();
    const txnId = 'txn_123';
    const eventId = 'evt_123';

    const res = repo.atomicSaveBankEvent({
      source: {
        id: sourceId,
        mailboxId: 'me',
        gmailMessageId: 'msg_gmail_123',
        rfcMessageId: '<test@bank.com>',
        parserStatus: 'ACCEPTED',
        createdAt: new Date().toISOString(),
      },
      transaction: {
        id: txnId,
        sourceMessageId: sourceId,
        bank: 'ACB',
        direction: 'CREDIT',
        amount: '500000',
        currency: 'VND',
        accountMasked: '123***789',
        description: 'Chuyen tien test',
        transactionAt: new Date().toISOString(),
        fingerprint: 'fp_abc123',
        status: 'CONFIRMED',
        createdAt: new Date().toISOString(),
      },
      event: {
        id: eventId,
        transactionId: txnId,
        eventType: 'bank.credit.received',
        payloadJson: JSON.stringify({ hello: 'world' }),
        createdAt: new Date().toISOString(),
      },
    });

    expect(res.deliveriesCount).toBe(1);

    // Verify source message exists
    const source = repo.getSourceMessageByGmailId('msg_gmail_123');
    expect(source).not.toBeNull();
    expect(source?.parserStatus).toBe('ACCEPTED');

    // Verify fingerprint check
    const txn = repo.findTransactionByFingerprint('fp_abc123');
    expect(txn).not.toBeNull();
    expect(txn?.amount).toBe('500000');

    // Verify outbox claim
    const claimed = repo.claimPendingDeliveries('worker-1', 30, 10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].eventId).toBe(eventId);
    expect(claimed[0].status).toBe('IN_FLIGHT');
    expect(claimed[0].leaseOwner).toBe('worker-1');

    // Mark delivery success
    repo.markDeliverySuccess(claimed[0].id, 200);

    const metrics = repo.getQueueMetrics();
    expect(metrics.delivered).toBe(1);
    expect(metrics.pending).toBe(0);
    expect(metrics.inFlight).toBe(0);
  });

  it('marks delivery failure and schedules retry', () => {
    const epId = 'ep_test_2';
    const secretCiphertext = encryptSecret('whsec_secret_2', masterKey, epId);
    repo.addWebhookEndpoint({
      id: epId,
      name: 'Retry Endpoint',
      url: 'https://api.example.com/retry',
      secretCiphertext,
    });

    const sourceId = crypto.randomUUID();
    const txnId = 'txn_retry';
    const eventId = 'evt_retry';

    repo.atomicSaveBankEvent({
      source: {
        id: sourceId,
        mailboxId: 'me',
        gmailMessageId: 'msg_retry_123',
        parserStatus: 'ACCEPTED',
        createdAt: new Date().toISOString(),
      },
      transaction: {
        id: txnId,
        sourceMessageId: sourceId,
        bank: 'ACB',
        direction: 'CREDIT',
        amount: '100000',
        currency: 'VND',
        accountMasked: '123***789',
        transactionAt: new Date().toISOString(),
        fingerprint: 'fp_retry_123',
        status: 'CONFIRMED',
        createdAt: new Date().toISOString(),
      },
      event: {
        id: eventId,
        transactionId: txnId,
        eventType: 'bank.credit.received',
        payloadJson: JSON.stringify({ retry: true }),
        createdAt: new Date().toISOString(),
      },
    });

    const claimed = repo.claimPendingDeliveries('worker-test', 30, 10);
    expect(claimed).toHaveLength(1);

    const nextAttemptAt = new Date(Date.now() + 60000).toISOString();
    repo.markDeliveryFailure({
      id: claimed[0].id,
      httpStatus: 502,
      error: 'Bad Gateway',
      nextAttemptAt,
      isDeadLetter: false,
    });

    const metrics = repo.getQueueMetrics();
    expect(metrics.retrying).toBe(1);
  });
});
