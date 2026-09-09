import type { Repository } from '../db/repository.js';
import type { GmailService } from './client.js';
import type { MessageSyncer } from './syncer.js';
import { logger } from '../logger.js';
import type { Config } from '../config.js';

export class HistoryReconciler {
  private isReconciling = false;

  constructor(
    private repository: Repository,
    private gmailService: GmailService,
    private syncer: MessageSyncer,
    private config: Config
  ) {}

  async reconcile(targetHistoryId?: string): Promise<{ processed: number; newHistoryId?: string }> {
    if (this.isReconciling) {
      logger.debug('Reconciliation already in progress, skipping concurrent run');
      return { processed: 0 };
    }

    this.isReconciling = true;

    try {
      const state = this.repository.getGmailState(this.config.GMAIL_MAILBOX_ID);
      const gmail = this.gmailService.getClient();

      // If no last_history_id stored, bootstrap cursor
      if (!state || !state.lastHistoryId) {
        logger.info('No last_history_id found in database - bootstrapping initial cursor');
        const latestHistoryId = await this.gmailService.getLatestHistoryId();
        this.repository.setGmailState({
          mailboxId: this.config.GMAIL_MAILBOX_ID,
          lastHistoryId: latestHistoryId,
          updatedAt: new Date().toISOString(),
        });
        return { processed: 0, newHistoryId: latestHistoryId };
      }

      const startHistoryId = state.lastHistoryId;
      logger.debug({ startHistoryId, targetHistoryId }, 'Starting Gmail history reconciliation');

      let pageToken: string | undefined;
      let highestHistoryId = startHistoryId;
      let processedCount = 0;
      const messageIdsToProcess = new Set<string>();

      try {
        do {
          const res = await gmail.users.history.list({
            userId: this.config.GMAIL_MAILBOX_ID,
            startHistoryId,
            pageToken,
            historyTypes: ['messageAdded'],
          });

          if (res.data.historyId) {
            if (BigInt(res.data.historyId) > BigInt(highestHistoryId)) {
              highestHistoryId = res.data.historyId;
            }
          }

          if (res.data.history) {
            for (const record of res.data.history) {
              if (record.id && BigInt(record.id) > BigInt(highestHistoryId)) {
                highestHistoryId = record.id;
              }
              if (record.messagesAdded) {
                for (const item of record.messagesAdded) {
                  if (item.message?.id) {
                    messageIdsToProcess.add(item.message.id);
                  }
                }
              }
            }
          }

          pageToken = res.data.nextPageToken || undefined;
        } while (pageToken);
      } catch (err: any) {
        // Check for 404 (History ID is expired / outside history window)
        if (err.status === 404 || err.code === 404 || err.message?.includes('historyId')) {
          logger.warn(
            { startHistoryId, err: err.message },
            'Gmail historyId is expired or invalid (404). Falling back to bounded message scan recovery'
          );
          return await this.recoverFromExpiredHistory();
        }
        throw err;
      }

      // Ingest all discovered messages
      for (const msgId of messageIdsToProcess) {
        try {
          await this.syncer.processMessage(msgId, highestHistoryId);
          processedCount++;
        } catch (err: any) {
          logger.error({ msgId, err: err.message }, 'Error ingesting message during reconciliation');
          // continue processing other messages
        }
      }

      // Update cursor
      this.repository.setGmailState({
        mailboxId: this.config.GMAIL_MAILBOX_ID,
        lastHistoryId: highestHistoryId,
        updatedAt: new Date().toISOString(),
      });

      logger.info(
        { processedCount, startHistoryId, newHistoryId: highestHistoryId },
        'Gmail history reconciliation completed'
      );

      return { processed: processedCount, newHistoryId: highestHistoryId };
    } finally {
      this.isReconciling = false;
    }
  }

  /**
   * Bounded recovery scan when historyId expires (e.g. after prolonged downtime)
   */
  private async recoverFromExpiredHistory(): Promise<{ processed: number; newHistoryId?: string }> {
    const gmail = this.gmailService.getClient();

    // Query messages in the last 4 hours
    const secondsAgo = Math.floor(Date.now() / 1000) - 4 * 3600;
    const query = `after:${secondsAgo}`;

    logger.info({ query }, 'Executing bounded recovery message search');

    const res = await gmail.users.messages.list({
      userId: this.config.GMAIL_MAILBOX_ID,
      q: query,
      maxResults: 50,
    });

    const messages = res.data.messages || [];
    let count = 0;

    for (const item of messages) {
      if (item.id) {
        try {
          await this.syncer.processMessage(item.id);
          count++;
        } catch (err: any) {
          logger.error({ msgId: item.id, err: err.message }, 'Failed to ingest message during recovery scan');
        }
      }
    }

    const latestHistoryId = await this.gmailService.getLatestHistoryId();
    this.repository.setGmailState({
      mailboxId: this.config.GMAIL_MAILBOX_ID,
      lastHistoryId: latestHistoryId,
      updatedAt: new Date().toISOString(),
    });

    this.repository.logAudit({
      entityType: 'GMAIL_SYNC',
      entityId: this.config.GMAIL_MAILBOX_ID,
      action: 'HISTORY_EXPIRY_RECOVERY',
      actor: 'system',
      detailsJson: JSON.stringify({ scannedMessages: count, resetHistoryId: latestHistoryId }),
    });

    logger.info({ count, latestHistoryId }, 'Recovery scan completed and cursor reset');
    return { processed: count, newHistoryId: latestHistoryId };
  }
}
