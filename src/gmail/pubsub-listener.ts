import { PubSub } from '@google-cloud/pubsub';
import type { HistoryReconciler } from './reconciliation.js';
import { logger } from '../logger.js';
import type { Config } from '../config.js';

export class PubSubListener {
  private pubsubClient: PubSub | null = null;
  private subscription: any = null;

  constructor(
    private reconciler: HistoryReconciler,
    private config: Config
  ) {}

  start(): void {
    if (!this.config.PUBSUB_SUBSCRIPTION_NAME) {
      logger.info('PUBSUB_SUBSCRIPTION_NAME is not configured - running in periodic reconciliation mode only');
      return;
    }

    try {
      this.pubsubClient = new PubSub({
        keyFilename: this.config.PUBSUB_CREDENTIALS_PATH,
      });

      this.subscription = this.pubsubClient.subscription(this.config.PUBSUB_SUBSCRIPTION_NAME);

      this.subscription.on('message', async (message: any) => {
        try {
          const rawData = message.data.toString();
          logger.debug({ id: message.id }, 'Received Google Pub/Sub notification');

          let historyId: string | undefined;
          try {
            const parsed = JSON.parse(rawData);
            historyId = parsed.historyId;
          } catch {
            // rawData may not be JSON or just raw text
          }

          // Trigger reconciliation
          await this.reconciler.reconcile(historyId);

          // ACK message
          message.ack();
        } catch (err: any) {
          logger.error({ id: message.id, err: err.message }, 'Failed to process Pub/Sub message');
          message.nack();
        }
      });

      this.subscription.on('error', (err: any) => {
        logger.error({ err: err.message }, 'Google Pub/Sub subscription error');
      });

      logger.info(
        { subscription: this.config.PUBSUB_SUBSCRIPTION_NAME },
        'Google Pub/Sub StreamingPull subscriber started'
      );
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to initialize Google Pub/Sub client');
    }
  }

  async stop(): Promise<void> {
    if (this.subscription) {
      logger.info('Stopping Pub/Sub subscription');
      await this.subscription.close();
      this.subscription = null;
    }
  }
}
