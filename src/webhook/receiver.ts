import { verifyWebhookSignature } from '../crypto.js';

export interface BankEventPayload {
  schemaVersion: 1;
  id: string;
  type: 'bank.credit.received';
  occurredAt: string;
  observedAt: string;
  source: 'gmail';
  bank: 'ACB';
  transaction: {
    id: string;
    direction: 'CREDIT';
    amount: string; // positive integer string
    currency: 'VND';
    accountMasked: string;
    description: string;
    transactionAt: string;
    reference?: string;
  };
}

export interface WebhookVerificationResult {
  valid: boolean;
  error?: string;
  payload?: BankEventPayload;
}

/**
 * Standard receiver verification for consumers (e.g. Messenger backend, ERP, order service)
 */
export function verifyIncomingWebhook(params: {
  rawBody: Buffer | string;
  headers: Record<string, string | string[] | undefined>;
  secret: string;
  toleranceSeconds?: number;
}): WebhookVerificationResult {
  // Case-insensitive header lookup
  const getHeader = (name: string): string | undefined => {
    const target = name.toLowerCase();
    for (const [k, v] of Object.entries(params.headers)) {
      if (k.toLowerCase() === target) {
        if (Array.isArray(v)) return v[0];
        return v;
      }
    }
    return undefined;
  };

  const signatureHeader = getHeader('x-webhook-signature');
  const timestampHeader = getHeader('x-webhook-timestamp');
  const eventIdHeader = getHeader('x-webhook-id');

  if (!signatureHeader || !timestampHeader || !eventIdHeader) {
    return {
      valid: false,
      error: 'Missing required webhook headers (X-Webhook-Signature, X-Webhook-Timestamp, X-Webhook-Id)',
    };
  }

  // Verify HMAC signature
  const sigCheck = verifyWebhookSignature(
    params.secret,
    timestampHeader,
    params.rawBody,
    signatureHeader,
    params.toleranceSeconds ?? 300
  );

  if (!sigCheck.valid) {
    return {
      valid: false,
      error: sigCheck.reason || 'Invalid webhook signature',
    };
  }

  // Parse and validate payload
  try {
    const bodyStr = typeof params.rawBody === 'string' ? params.rawBody : params.rawBody.toString('utf8');
    const payload = JSON.parse(bodyStr) as BankEventPayload;

    if (payload.id !== eventIdHeader) {
      return {
        valid: false,
        error: 'Event ID in header does not match ID in payload',
      };
    }

    if (payload.schemaVersion !== 1 || payload.type !== 'bank.credit.received') {
      return {
        valid: false,
        error: 'Unsupported payload schemaVersion or event type',
      };
    }

    return {
      valid: true,
      payload,
    };
  } catch (err: any) {
    return {
      valid: false,
      error: `Failed to parse payload JSON: ${err.message}`,
    };
  }
}
