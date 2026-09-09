import crypto from 'node:crypto';
import type { Repository } from '../db/repository.js';
import { decryptSecret, signWebhookPayload } from '../crypto.js';
import { validateWebhookUrl } from './ssrf-guard.js';
import { logger } from '../logger.js';
import type { Config } from '../config.js';

export class WebhookDispatcher {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private workerId: string;

  constructor(
    private repository: Repository,
    private config: Config
  ) {
    this.workerId = `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info({ workerId: this.workerId }, 'Starting Webhook Dispatcher');
    this.scheduleNextTick(100);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Webhook Dispatcher stopped');
  }

  trigger(): void {
    if (!this.isRunning) return;
    setImmediate(() => this.processBatch());
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => {
      this.processBatch().finally(() => {
        if (this.isRunning) {
          this.scheduleNextTick(1000); // Check outbox every 1 second
        }
      });
    }, delayMs);
  }

  async processBatch(): Promise<number> {
    const leaseSeconds = 30;
    const batchSize = 10;

    let deliveries;
    try {
      deliveries = this.repository.claimPendingDeliveries(this.workerId, leaseSeconds, batchSize);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to claim pending webhook deliveries');
      return 0;
    }

    if (deliveries.length === 0) {
      return 0;
    }

    logger.debug({ count: deliveries.length }, 'Processing claimed webhook deliveries');

    // Process each delivery independently so one slow endpoint doesn't block others
    await Promise.allSettled(
      deliveries.map((delivery) => this.dispatchDelivery(delivery))
    );

    return deliveries.length;
  }

  private async dispatchDelivery(delivery: {
    id: string;
    eventId: string;
    endpointId: string;
    attemptCount: number;
    payloadJson: string;
    endpointUrl: string;
    secretCiphertext: string;
    timeoutMs: number;
    keyVersion: string;
    createdAt: string;
  }): Promise<void> {
    const { id, eventId, endpointId, endpointUrl, timeoutMs } = delivery;

    // 1. Validate SSRF & protocol
    const ssrfResult = await validateWebhookUrl(endpointUrl);
    if (!ssrfResult.allowed) {
      logger.warn(
        { deliveryId: id, endpointUrl, reason: ssrfResult.reason },
        'Webhook delivery rejected by SSRF guard - marking DEAD_LETTER'
      );
      this.repository.markDeliveryFailure({
        id,
        error: `SSRF rejected: ${ssrfResult.reason}`,
        nextAttemptAt: new Date().toISOString(),
        isDeadLetter: true,
      });
      return;
    }

    // 2. Decrypt endpoint secret
    let secret: string;
    try {
      secret = decryptSecret(delivery.secretCiphertext, this.config.APP_MASTER_KEY, endpointId);
    } catch (err: any) {
      logger.error({ deliveryId: id, endpointId, err: err.message }, 'Failed to decrypt endpoint secret');
      this.repository.markDeliveryFailure({
        id,
        error: `Decryption error: ${err.message}`,
        nextAttemptAt: new Date().toISOString(),
        isDeadLetter: true,
      });
      return;
    }

    // 3. Prepare signature and headers
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(secret, timestamp, delivery.payloadJson);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'bank-event-gateway/1.0',
      'X-Webhook-Id': eventId,
      'X-Webhook-Timestamp': timestamp.toString(),
      'X-Webhook-Key-Id': delivery.keyVersion || 'v1',
      'X-Webhook-Signature': signature,
    };

    // 4. Send HTTP request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs || this.config.WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: delivery.payloadJson,
        signal: controller.signal,
        redirect: 'error', // strict no redirect
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        // 2xx Success!
        logger.info(
          { deliveryId: id, eventId, endpointId, status: response.status },
          'Webhook successfully delivered'
        );
        this.repository.markDeliverySuccess(id, response.status);
        return;
      }

      // Handle non-2xx status
      const responseText = await response.text().catch(() => '');
      const trimmedError = responseText.slice(0, 500);

      // Check if permanent 4xx (except 408 Request Timeout, 429 Too Many Requests)
      const isPermanent4xx = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;

      if (isPermanent4xx) {
        logger.warn(
          { deliveryId: id, status: response.status, body: trimmedError },
          'Webhook received permanent 4xx client error - marking DEAD_LETTER'
        );
        this.repository.markDeliveryFailure({
          id,
          httpStatus: response.status,
          error: `HTTP ${response.status}: ${trimmedError}`,
          nextAttemptAt: new Date().toISOString(),
          isDeadLetter: true,
        });
        return;
      }

      // Retryable 5xx, 408, 429
      let retryAfterSeconds: number | null = null;
      const retryAfterHeader = response.headers.get('retry-after');
      if (retryAfterHeader) {
        const parsed = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsed) && parsed > 0) {
          retryAfterSeconds = Math.min(parsed, 3600); // cap at 1 hour
        }
      }

      this.handleRetry({
        delivery,
        httpStatus: response.status,
        error: `HTTP ${response.status}: ${trimmedError}`,
        retryAfterSeconds,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isAbort = err.name === 'AbortError';
      const errorMsg = isAbort ? `Request timed out after ${timeoutMs}ms` : err.message;

      logger.warn(
        { deliveryId: id, eventId, error: errorMsg },
        'Webhook delivery failed with network error/timeout'
      );

      this.handleRetry({
        delivery,
        error: errorMsg,
      });
    }
  }

  private handleRetry(params: {
    delivery: {
      id: string;
      attemptCount: number;
      createdAt: string;
    };
    httpStatus?: number;
    error: string;
    retryAfterSeconds?: number | null;
  }): void {
    const nextAttemptCount = params.delivery.attemptCount + 1;
    const createdAtTime = new Date(params.delivery.createdAt).getTime();
    const ageHours = (Date.now() - createdAtTime) / (1000 * 60 * 60);

    const isExceededAttempts = nextAttemptCount >= this.config.MAX_RETRY_ATTEMPTS;
    const isExceededDuration = ageHours >= this.config.MAX_RETRY_DURATION_HOURS;

    if (isExceededAttempts || isExceededDuration) {
      logger.error(
        {
          deliveryId: params.delivery.id,
          attempts: nextAttemptCount,
          ageHours,
          reason: isExceededAttempts ? 'Max attempts reached' : 'Max retry duration exceeded',
        },
        'Webhook delivery permanently dead-lettered'
      );
      this.repository.markDeliveryFailure({
        id: params.delivery.id,
        httpStatus: params.httpStatus,
        error: `${params.error} (Max retries reached)`,
        nextAttemptAt: new Date().toISOString(),
        isDeadLetter: true,
      });
      return;
    }

    // Exponential backoff with jitter:
    // base delay 5s * 2^(attempt - 1) + random jitter [0, 5s]
    let backoffSeconds: number;
    if (params.retryAfterSeconds) {
      backoffSeconds = params.retryAfterSeconds;
    } else {
      const baseDelay = 5;
      const exponential = baseDelay * Math.pow(2, Math.min(nextAttemptCount - 1, 10));
      const jitter = Math.floor(Math.random() * 5);
      backoffSeconds = Math.min(exponential + jitter, 1800); // cap backoff at 30 minutes
    }

    const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

    logger.info(
      { deliveryId: params.delivery.id, nextAttemptCount, backoffSeconds, nextAttemptAt },
      'Scheduling webhook delivery retry'
    );

    this.repository.markDeliveryFailure({
      id: params.delivery.id,
      httpStatus: params.httpStatus,
      error: params.error,
      nextAttemptAt,
      isDeadLetter: false,
    });
  }
}
