import crypto from 'node:crypto';

export interface EncryptedData {
  version: 'v1';
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Encrypt a plaintext secret using AES-256-GCM with associated authenticated data (AAD)
 */
export function encryptSecret(
  plaintext: string,
  masterKeyHex: string,
  associatedData: string
): string {
  const masterKey = Buffer.from(masterKeyHex, 'hex');
  if (masterKey.length !== 32) {
    throw new Error('Master key must be exactly 32 bytes (64 hex characters)');
  }

  const iv = crypto.randomBytes(12); // standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  
  // Set associated authenticated data (bind to endpoint ID)
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt ciphertext using AES-256-GCM with associated authenticated data (AAD)
 */
export function decryptSecret(
  serialized: string,
  masterKeyHex: string,
  associatedData: string
): string {
  const parts = serialized.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid secret ciphertext format');
  }

  const [, ivHex, authTagHex, ciphertextHex] = parts;
  const masterKey = Buffer.from(masterKeyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Compute HMAC-SHA256 signature for webhook payload
 * Signature input is: `${timestamp}.${rawBody}`
 */
export function signWebhookPayload(
  secret: string,
  timestamp: number | string,
  rawBody: Buffer | string
): string {
  const bodyBuffer = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.`);
  hmac.update(bodyBuffer);
  return `v1=${hmac.digest('hex')}`;
}

/**
 * Verify HMAC signature with constant-time equality check
 */
export function verifyWebhookSignature(
  secret: string,
  timestamp: number | string,
  rawBody: Buffer | string,
  expectedSignatureHeader: string,
  toleranceSeconds: number = 300
): { valid: boolean; reason?: string } {
  const now = Math.floor(Date.now() / 1000);
  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;

  if (Number.isNaN(ts)) {
    return { valid: false, reason: 'Invalid timestamp' };
  }

  if (Math.abs(now - ts) > toleranceSeconds) {
    return { valid: false, reason: 'Timestamp outside acceptable window' };
  }

  const computedSig = signWebhookPayload(secret, ts, rawBody);
  
  // Extract hash part
  const expectedSig = expectedSignatureHeader.trim();
  
  if (computedSig.length !== expectedSig.length) {
    return { valid: false, reason: 'Signature length mismatch' };
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(computedSig, 'utf8'),
    Buffer.from(expectedSig, 'utf8')
  );

  return isValid ? { valid: true } : { valid: false, reason: 'Signature mismatch' };
}

/**
 * Generate SHA-256 hex string for fingerprinting
 */
export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
