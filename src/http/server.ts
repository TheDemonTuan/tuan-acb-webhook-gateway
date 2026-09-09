import Fastify, { type FastifyInstance } from 'fastify';
import type { Repository } from '../db/repository.js';
import type { Config } from '../config.js';

export function buildServer(
  repository: Repository,
  config: Config
): FastifyInstance {
  const app = Fastify({
    logger: false, // pino is used at the service level
  });

  // Root information
  app.get('/', async () => {
    return {
      service: 'bank-event-gateway',
      status: 'running',
      version: '1.0.0',
    };
  });

  // Liveness check (checks if Node process is responsive)
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get('/live', async () => {
    return { status: 'ok' };
  });

  // Readiness check (checks if DB and subsystems are healthy)
  app.get('/ready', async (_req, reply) => {
    try {
      // Test DB connection with lightweight query
      const queue = repository.getQueueMetrics();
      const gmailState = repository.getGmailState(config.GMAIL_MAILBOX_ID);

      return {
        status: 'ready',
        database: 'healthy',
        queue,
        lastHistoryId: gmailState?.lastHistoryId || null,
        watchExpirationAt: gmailState?.watchExpirationAt
          ? new Date(gmailState.watchExpirationAt).toISOString()
          : null,
      };
    } catch (err: any) {
      reply.status(503);
      return {
        status: 'unready',
        error: err.message,
      };
    }
  });

  // Internal metrics
  app.get('/metrics', async () => {
    const queue = repository.getQueueMetrics();
    const gmailState = repository.getGmailState(config.GMAIL_MAILBOX_ID);
    const endpoints = repository.listWebhookEndpoints();

    return {
      queue,
      endpointsCount: endpoints.length,
      activeEndpointsCount: endpoints.filter((e) => e.enabled === 1).length,
      gmailSync: {
        lastHistoryId: gmailState?.lastHistoryId || null,
        watchExpirationAt: gmailState?.watchExpirationAt || null,
        updatedAt: gmailState?.updatedAt || null,
      },
      memory: process.memoryUsage(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });

  return app;
}
