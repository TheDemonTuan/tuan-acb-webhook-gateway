import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { google } from 'googleapis';
import type { Repository } from '../db/repository.js';
import type { Config } from '../config.js';
import type { GmailService } from '../gmail/client.js';
import type { HistoryReconciler } from '../gmail/reconciliation.js';
import type { WebhookDispatcher } from '../webhook/dispatcher.js';
import { encryptSecret, decryptSecret, signWebhookPayload } from '../crypto.js';
import { validateWebhookUrl } from '../webhook/ssrf-guard.js';
import { authenticateRequest } from './auth.js';
import { getDashboardHtml } from './dashboard-html.js';
import { logger } from '../logger.js';

export interface ServerServices {
  gmailService?: GmailService;
  reconciler?: HistoryReconciler;
  dispatcher?: WebhookDispatcher;
}

export function buildServer(
  repository: Repository,
  config: Config,
  services: ServerServices = {}
): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  // Global Auth Hook for /api/ routes
  app.addHook('preHandler', async (req, reply) => {
    const isAllowed = await authenticateRequest(req, reply, config);
    if (!isAllowed) {
      // reply was already sent by authenticateRequest
      return;
    }
  });

  // 1. Dashboard Web UI (React 19 build or fallback)
  const candidateDirs = [
    path.resolve(process.cwd(), 'dist/web'),
    path.resolve(process.cwd(), 'web/dist'),
    path.resolve(import.meta.dirname, '../web'),
    path.resolve(import.meta.dirname, '../../dist/web'),
  ];
  const webDir = candidateDirs.find((d) => fs.existsSync(path.join(d, 'index.html')));

  if (webDir) {
    logger.info({ webDir }, 'Serving React 19 Dashboard UI via @fastify/static');
    app.register(fastifyStatic, {
      root: webDir,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0];
      if (url.startsWith('/api/')) {
        reply.status(404).send({ error: 'API route not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  } else {
    app.get('/', async (_req, reply) => {
      reply.type('text/html; charset=utf-8').send(getDashboardHtml());
    });

    app.get('/dashboard', async (_req, reply) => {
      reply.type('text/html; charset=utf-8').send(getDashboardHtml());
    });
  }

  // 2. Liveness & Readiness Checks
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get('/live', async () => {
    return { status: 'ok' };
  });

  app.get('/ready', async (_req, reply) => {
    try {
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

  // 3. Metrics (Prometheus / JSON)
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

  // ==================== DASHBOARD API ====================

  // GET /api/status - Extended status for the dashboard
  app.get('/api/status', async () => {
    const queue = repository.getQueueMetrics();
    const gmailState = repository.getGmailState(config.GMAIL_MAILBOX_ID);
    const endpoints = repository.listWebhookEndpoints();

    const hasCredentials = fs.existsSync(config.GMAIL_CREDENTIALS_PATH);
    const hasToken = fs.existsSync(config.GMAIL_TOKEN_PATH);

    return {
      status: 'ok',
      database: 'healthy',
      queue,
      endpointsCount: endpoints.length,
      activeEndpointsCount: endpoints.filter((e) => e.enabled === 1).length,
      uptimeSeconds: Math.floor(process.uptime()),
      gmailAuth: {
        hasCredentials,
        hasToken,
      },
      gmailSync: {
        lastHistoryId: gmailState?.lastHistoryId || null,
        watchExpirationAt: gmailState?.watchExpirationAt
          ? new Date(gmailState.watchExpirationAt).toISOString()
          : null,
        updatedAt: gmailState?.updatedAt || null,
      },
    };
  });

  // GET /api/endpoints - List Webhooks
  app.get('/api/endpoints', async () => {
    const endpoints = repository.listWebhookEndpoints();
    return endpoints.map((e) => ({
      id: e.id,
      name: e.name,
      url: e.url,
      enabled: Boolean(e.enabled),
      timeoutMs: e.timeoutMs,
      keyVersion: e.keyVersion,
      filter: e.eventFilterJson ? JSON.parse(e.eventFilterJson) : null,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
  });

  // POST /api/endpoints - Register New Webhook
  app.post('/api/endpoints', async (req, reply) => {
    const body = req.body as any;
    if (!body || !body.name || !body.url || !body.secret) {
      reply.status(400);
      return { error: 'Tên, URL và secret key là bắt buộc.' };
    }

    // SSRF Check on URL
    const ssrf = await validateWebhookUrl(body.url);
    if (!ssrf.allowed) {
      reply.status(400);
      return { error: `URL bị từ chối: ${ssrf.reason}` };
    }

    const id = `ep_${crypto.randomUUID()}`;
    const secretCiphertext = encryptSecret(body.secret.trim(), config.APP_MASTER_KEY, id);

    let filterJson: string | undefined;
    if (body.filter && Array.isArray(body.filter)) {
      filterJson = JSON.stringify(body.filter);
    }

    repository.addWebhookEndpoint({
      id,
      name: body.name.trim(),
      url: body.url.trim(),
      secretCiphertext,
      eventFilterJson: filterJson,
      timeoutMs: body.timeoutMs || config.WEBHOOK_TIMEOUT_MS,
    });

    repository.logAudit({
      entityType: 'WEBHOOK_ENDPOINT',
      entityId: id,
      action: 'CREATE',
      actor: (req as any).authUser || 'admin',
      detailsJson: JSON.stringify({ name: body.name, url: body.url }),
    });

    return { success: true, id, name: body.name, url: body.url };
  });

  // PATCH /api/endpoints/:id/toggle - Toggle Enable/Disable
  app.patch('/api/endpoints/:id/toggle', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { enabled: boolean };

    const ep = repository.getEndpointById(id);
    if (!ep) {
      reply.status(404);
      return { error: 'Không tìm thấy endpoint' };
    }

    repository.toggleWebhookEndpoint(id, body.enabled);
    return { success: true, id, enabled: body.enabled };
  });

  // DELETE /api/endpoints/:id - Delete Endpoint
  app.delete('/api/endpoints/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ep = repository.getEndpointById(id);
    if (!ep) {
      reply.status(404);
      return { error: 'Không tìm thấy endpoint' };
    }

    repository.deleteWebhookEndpoint(id);
    repository.logAudit({
      entityType: 'WEBHOOK_ENDPOINT',
      entityId: id,
      action: 'DELETE',
      actor: (req as any).authUser || 'admin',
      detailsJson: JSON.stringify({ name: ep.name, url: ep.url }),
    });

    return { success: true, id };
  });

  // POST /api/endpoints/:id/test - Test Ping Webhook
  app.post('/api/endpoints/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ep = repository.getEndpointById(id);
    if (!ep) {
      reply.status(404);
      return { error: 'Không tìm thấy endpoint' };
    }

    // SSRF Check
    const ssrf = await validateWebhookUrl(ep.url);
    if (!ssrf.allowed) {
      reply.status(400);
      return { error: `SSRF Guard chặn: ${ssrf.reason}` };
    }

    let secret: string;
    try {
      secret = decryptSecret(ep.secretCiphertext, config.APP_MASTER_KEY, ep.id);
    } catch (err: any) {
      reply.status(500);
      return { error: `Giải mã secret thất bại: ${err.message}` };
    }

    const testEventId = `evt_test_${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    const timestamp = Math.floor(Date.now() / 1000);

    const testPayload = {
      schemaVersion: 1,
      id: testEventId,
      type: 'bank.credit.received',
      occurredAt: nowIso,
      observedAt: nowIso,
      source: 'test_ping',
      bank: 'ACB',
      transaction: {
        id: `txn_test_${crypto.randomUUID()}`,
        direction: 'CREDIT',
        amount: '100000',
        currency: 'VND',
        accountMasked: '123***789',
        description: 'Test Webhook Ping from Gateway Dashboard',
        transactionAt: nowIso,
        reference: 'TESTPING999',
      },
    };

    const rawBody = JSON.stringify(testPayload);
    const signature = signWebhookPayload(secret, timestamp, rawBody);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ep.timeoutMs || 10000);

    try {
      const response = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'bank-event-gateway-test/1.0',
          'X-Webhook-Id': testEventId,
          'X-Webhook-Timestamp': timestamp.toString(),
          'X-Webhook-Key-Id': ep.keyVersion || 'v1',
          'X-Webhook-Signature': signature,
        },
        body: rawBody,
        signal: controller.signal,
        redirect: 'error',
      });

      clearTimeout(timeoutId);
      const text = await response.text().catch(() => '');

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        responseBody: text.slice(0, 300),
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: err.name === 'AbortError' ? 'Timeout 10s' : err.message,
      };
    }
  });

  // GET /api/events - List Recent Events
  app.get('/api/events', async () => {
    return repository.listRecentEvents(50);
  });

  // GET /api/deliveries - List Recent Deliveries
  app.get('/api/deliveries', async () => {
    return repository.listRecentDeliveries(50);
  });

  // POST /api/deliveries/:id/replay - Manual Replay
  app.post('/api/deliveries/:id/replay', async (req, reply) => {
    const { id } = req.params as { id: string };
    const nowIso = new Date().toISOString();

    const db = (repository as any).db;
    const res = db
      .prepare(`
        UPDATE webhook_deliveries
        SET status = 'PENDING',
            next_attempt_at = ?,
            lease_owner = NULL,
            lease_until = NULL,
            updated_at = ?
        WHERE id = ?
      `)
      .run(nowIso, nowIso, id);

    if (res.changes === 0) {
      reply.status(404);
      return { error: 'Không tìm thấy delivery' };
    }

    repository.logAudit({
      entityType: 'WEBHOOK_DELIVERY',
      entityId: id,
      action: 'MANUAL_REPLAY',
      actor: (req as any).authUser || 'admin',
    });

    if (services.dispatcher) {
      services.dispatcher.trigger();
    }

    return { success: true, id };
  });

  // POST /api/gmail/credentials - Save Client Credentials JSON
  app.post('/api/gmail/credentials', async (req, reply) => {
    const body = req.body as { credentialsJson: string };
    if (!body || !body.credentialsJson) {
      reply.status(400);
      return { error: 'Nội dung credentials JSON là bắt buộc.' };
    }

    let parsed;
    try {
      parsed = JSON.parse(body.credentialsJson);
      const details = parsed.installed || parsed.web;
      if (!details || !details.client_id || !details.client_secret) {
        throw new Error('Thiếu installed/web hoặc client_id/client_secret trong JSON.');
      }
    } catch (err: any) {
      reply.status(400);
      return { error: `JSON không hợp lệ: ${err.message}` };
    }

    const dir = path.dirname(config.GMAIL_CREDENTIALS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(config.GMAIL_CREDENTIALS_PATH, JSON.stringify(parsed, null, 2), {
      mode: 0o600,
    });

    logger.info('Saved Gmail OAuth credentials from Web UI');
    return { success: true, message: 'Đã lưu file credentials thành công' };
  });

  // GET /api/gmail/auth-url - Generate Google OAuth Consent URL
  app.get('/api/gmail/auth-url', async (_req, reply) => {
    if (!fs.existsSync(config.GMAIL_CREDENTIALS_PATH)) {
      reply.status(400);
      return { error: 'Chưa có file credentials. Hãy lưu credentials trước.' };
    }

    try {
      const credsRaw = fs.readFileSync(config.GMAIL_CREDENTIALS_PATH, 'utf8');
      const creds = JSON.parse(credsRaw);
      const clientDetails = creds.installed || creds.web;

      const { client_id, client_secret, redirect_uris } = clientDetails;
      const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

      const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/gmail.readonly'],
      });

      return { authUrl };
    } catch (err: any) {
      reply.status(500);
      return { error: `Không thể tạo URL: ${err.message}` };
    }
  });

  // POST /api/gmail/exchange-code - Exchange Code for Token & Save
  app.post('/api/gmail/exchange-code', async (req, reply) => {
    const body = req.body as { code: string };
    if (!body || !body.code) {
      reply.status(400);
      return { error: 'Mã authorization code là bắt buộc.' };
    }

    if (!fs.existsSync(config.GMAIL_CREDENTIALS_PATH)) {
      reply.status(400);
      return { error: 'Chưa cấu hình credentials file.' };
    }

    try {
      const credsRaw = fs.readFileSync(config.GMAIL_CREDENTIALS_PATH, 'utf8');
      const creds = JSON.parse(credsRaw);
      const clientDetails = creds.installed || creds.web;

      const { client_id, client_secret, redirect_uris } = clientDetails;
      const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

      const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
      const { tokens } = await oAuth2Client.getToken(body.code.trim());

      const tokenDir = path.dirname(config.GMAIL_TOKEN_PATH);
      if (!fs.existsSync(tokenDir)) {
        fs.mkdirSync(tokenDir, { recursive: true });
      }

      fs.writeFileSync(config.GMAIL_TOKEN_PATH, JSON.stringify(tokens, null, 2), {
        mode: 0o600,
      });

      logger.info('Saved Gmail OAuth tokens from Web UI');

      // Re-init Gmail Service if available
      if (services.gmailService) {
        await services.gmailService.init();
      }

      return { success: true, message: 'Đã lưu token và kết nối Gmail thành công!' };
    } catch (err: any) {
      reply.status(400);
      return { error: `Lỗi trao đổi code với Google: ${err.message}` };
    }
  });

  // POST /api/gmail/renew-watch - Renew Pub/Sub Watch
  app.post('/api/gmail/renew-watch', async (_req, reply) => {
    if (!services.gmailService) {
      reply.status(400);
      return { error: 'Gmail Service chưa được kích hoạt.' };
    }

    if (!config.PUBSUB_TOPIC_NAME) {
      reply.status(400);
      return { error: 'Cần cấu hình PUBSUB_TOPIC_NAME trong file biến môi trường.' };
    }

    try {
      await services.gmailService.init();
      const res = await services.gmailService.watch(config.PUBSUB_TOPIC_NAME);

      repository.setGmailState({
        mailboxId: config.GMAIL_MAILBOX_ID,
        lastHistoryId: res.historyId,
        watchExpirationAt: res.expiration,
        updatedAt: new Date().toISOString(),
      });

      return {
        success: true,
        expiration: new Date(res.expiration).toISOString(),
        historyId: res.historyId,
      };
    } catch (err: any) {
      reply.status(500);
      return { error: `Gia hạn thất bại: ${err.message}` };
    }
  });

  // POST /api/gmail/sync-now - Trigger Immediate History Reconciliation
  app.post('/api/gmail/sync-now', async (_req, reply) => {
    if (!services.reconciler) {
      reply.status(400);
      return { error: 'Reconciler chưa được khởi tạo.' };
    }

    try {
      const res = await services.reconciler.reconcile();
      return { success: true, processed: res.processed, newHistoryId: res.newHistoryId };
    } catch (err: any) {
      reply.status(500);
      return { error: `Đồng bộ thất bại: ${err.message}` };
    }
  });

  return app;
}
