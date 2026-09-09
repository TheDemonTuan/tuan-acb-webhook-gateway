import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../../src/crypto.js';

describe('Crypto module', () => {
  const masterKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const endpointId = 'ep_123456';
  const secret = 'whsec_my_super_secret_webhook_key_xyz';

  it('encrypts and decrypts endpoint secret with AES-256-GCM and AAD', () => {
    const ciphertext = encryptSecret(secret, masterKeyHex, endpointId);
    expect(ciphertext.startsWith('v1:')).toBe(true);

    const decrypted = decryptSecret(ciphertext, masterKeyHex, endpointId);
    expect(decrypted).toBe(secret);
  });

  it('fails decryption if AAD (associated endpoint ID) does not match', () => {
    const ciphertext = encryptSecret(secret, masterKeyHex, endpointId);
    expect(() => {
      decryptSecret(ciphertext, masterKeyHex, 'ep_different');
    }).toThrow();
  });

  it('generates and verifies HMAC signatures with timestamp window', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ hello: 'world' });

    const signature = signWebhookPayload(secret, timestamp, rawBody);
    expect(signature.startsWith('v1=')).toBe(true);

    const checkValid = verifyWebhookSignature(secret, timestamp, rawBody, signature, 300);
    expect(checkValid.valid).toBe(true);

    // Tampered body
    const checkTampered = verifyWebhookSignature(secret, timestamp, '{"hello":"tampered"}', signature, 300);
    expect(checkTampered.valid).toBe(false);
    expect(checkTampered.reason).toBe('Signature mismatch');

    // Expired timestamp (e.g. 10 minutes ago)
    const oldTimestamp = timestamp - 600;
    const oldSignature = signWebhookPayload(secret, oldTimestamp, rawBody);
    const checkExpired = verifyWebhookSignature(secret, oldTimestamp, rawBody, oldSignature, 300);
    expect(checkExpired.valid).toBe(false);
    expect(checkExpired.reason).toBe('Timestamp outside acceptable window');
  });
});
