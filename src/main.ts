import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { initDatabase, closeDatabase } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { Repository } from './db/repository.js';
import { WebhookDispatcher } from './webhook/dispatcher.js';
import { GmailService } from './gmail/client.js';
import { MessageSyncer } from './gmail/syncer.js';
import { HistoryReconciler } from './gmail/reconciliation.js';
import { PubSubListener } from './gmail/pubsub-listener.js';
import { buildServer } from './http/server.js';
import { GmailOAuthService } from './gmail/oauth-service.js';
import fs from 'node:fs';

async function bootstrap() {
  logger.info('Starting Standalone Bank Event Gateway...');

  // 1. Load config
  const config = loadConfig();

  // 2. Init DB & run migrations
  const db = initDatabase(config.DATABASE_PATH);
  runMigrations(db);
  const repository = new Repository(db);

  // 3. Webhook Dispatcher
  const dispatcher = new WebhookDispatcher(repository, config);
  dispatcher.start();

  // 4. Gmail Ingestion Subsystem
  const oauthService = new GmailOAuthService(repository, config);
  const gmailService = new GmailService(config, oauthService);
  let hasGmailAuth = false;

  if (oauthService.getStatus().connected || (fs.existsSync(config.GMAIL_CREDENTIALS_PATH) && fs.existsSync(config.GMAIL_TOKEN_PATH))) {
    try {
      await gmailService.init();
      hasGmailAuth = true;
      logger.info('Gmail client initialized successfully');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to initialize Gmail client. Gateway will run without Gmail sync.');
    }
  } else {
    logger.warn(
      {
        credsExist: fs.existsSync(config.GMAIL_CREDENTIALS_PATH),
        tokenExist: fs.existsSync(config.GMAIL_TOKEN_PATH),
      },
      'Gmail credentials or token missing. Use CLI bootstrap-token to set up Gmail access.'
    );
  }

  const syncer = new MessageSyncer(repository, gmailService, dispatcher, config);
  const reconciler = new HistoryReconciler(repository, gmailService, syncer, config);
  const pubsubListener = new PubSubListener(reconciler, config);

  let reconcileTimer: NodeJS.Timeout | null = null;
  let watchRenewTimer: NodeJS.Timeout | null = null;

  const stopGmailIngestion = async () => {
    if (reconcileTimer) {
      clearInterval(reconcileTimer);
      reconcileTimer = null;
    }
    if (watchRenewTimer) {
      clearInterval(watchRenewTimer);
      watchRenewTimer = null;
    }
    await pubsubListener.stop();
    gmailService.reset();
  };

  const startGmailIngestion = async () => {
    if (reconcileTimer) return;
    await gmailService.init();
    hasGmailAuth = true;
    pubsubListener.start();
    const intervalMs = config.RECONCILE_INTERVAL_SECONDS * 1000;
    logger.info({ intervalSeconds: config.RECONCILE_INTERVAL_SECONDS }, 'Starting periodic reconciliation timer');
    reconciler.reconcile().catch((err) => logger.error({ err: err.message }, 'Initial reconciliation failed'));
    reconcileTimer = setInterval(() => {
      reconciler.reconcile().catch((err) => logger.error({ err: err.message }, 'Periodic reconciliation failed'));
    }, intervalMs);
    if (config.PUBSUB_TOPIC_NAME) {
      const renewWatch = () => gmailService.watch(config.PUBSUB_TOPIC_NAME!).then((watch) => {
        const current = repository.getGmailState(config.GMAIL_MAILBOX_ID);
        repository.setGmailState({
          mailboxId: config.GMAIL_MAILBOX_ID,
          lastHistoryId: current?.lastHistoryId || watch.historyId,
          watchExpirationAt: watch.expiration,
          updatedAt: new Date().toISOString(),
        });
      }).catch((err) => logger.error({ err: err.message }, 'Gmail watch renewal failed'));
      watchRenewTimer = setInterval(renewWatch, config.WATCH_RENEW_INTERVAL_HOURS * 60 * 60 * 1000);
    }
  };

  if (hasGmailAuth) {
    try {
      await startGmailIngestion();
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to start Gmail ingestion');
    }
  }
  // 5. Start Fastify Loopback Server & Web Dashboard
  const server = buildServer(repository, config, {
    gmailService,
    reconciler,
    dispatcher,
    oauthService,
    onGmailConnected: async () => {
      await stopGmailIngestion();
      await startGmailIngestion();
    },
    onGmailDisconnected: stopGmailIngestion,
  });

  try {
    await server.listen({ port: config.PORT, host: config.HOST });
    logger.info({ port: config.PORT, host: config.HOST }, 'HTTP Server running');
  } catch (err: any) {
    logger.fatal({ err: err.message }, 'Failed to bind HTTP server');
    process.exit(1);
  }

  // 6. Graceful Shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown initiated');

    if (reconcileTimer) {
      clearInterval(reconcileTimer);
      reconcileTimer = null;
    }

    await pubsubListener.stop().catch((err) => logger.error({ err: err.message }, 'Error stopping PubSub'));
    dispatcher.stop();
    await server.close().catch((err) => logger.error({ err: err.message }, 'Error closing HTTP server'));
    closeDatabase();

    logger.info('Gateway shutdown completed cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Fatal error during startup');
  process.exit(1);
});
