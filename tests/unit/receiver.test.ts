import { describe, it, expect } from 'vitest';
import { verifyIncomingWebhook } from '../../src/webhook/receiver.js';
import { signWebhookPayload } from '../../src/crypto.js';

describe('Webhook Receiver Helper', () => {
  const secret = 'whsec_sample_consumer_secret_123';
  const eventId = 'evt_test_12345';
  const samplePayload = {
    schemaVersion: 1,
    id: eventId,
    type: 'bank.credit.received',
    occurredAt: '2026-09-09T08:30:00.000Z',
    observedAt: '2026-09-09T08:30:05.000Z',
    source: 'gmail',
    bank: 'ACB',
    transaction: {
      id: 'txn_test_12345',
      direction: 'CREDIT',
      amount: '500000',
      currency: 'VND',
      accountMasked: '123***789',
      description: 'Test payment',
      transactionAt: '2026-09-09T08:30:00.000Z',
    },
  };

  it('verifies legitimate webhook with valid HMAC signature', () => {
    const rawBody = JSON.stringify(samplePayload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(secret, timestamp, rawBody);

    const headers = {
      'x-webhook-id': eventId,
      'x-webhook-timestamp': timestamp.toString(),
      'x-webhook-signature': signature,
    };

    const result = verifyIncomingWebhook({ rawBody, headers, secret });
    expect(result.valid).toBe(true);
    expect(result.payload?.transaction.amount).toBe('500000');
    expect(result.payload?.id).toBe(eventId);
  });

  it('rejects tampered body', () => {
    const rawBody = JSON.stringify(samplePayload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(secret, timestamp, rawBody);

    const tamperedBody = JSON.stringify({ ...samplePayload, amount: '9999999' });

    const headers = {
      'x-webhook-id': eventId,
      'x-webhook-timestamp': timestamp.toString(),
      'x-webhook-signature': signature,
    };

    const result = verifyIncomingWebhook({ rawBody: tamperedBody, headers, secret });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Signature mismatch');
  });

  it('rejects missing signature headers', () => {
    const rawBody = JSON.stringify(samplePayload);
    const result = verifyIncomingWebhook({ rawBody, headers: {}, secret });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing required webhook headers');
  });
});
