import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations.js';
import { Repository } from '../../src/db/repository.js';
import { buildServer } from '../../src/http/server.js';
import { loadConfig } from '../../src/config.js';
import * as auth from '../../src/http/auth.js';
import * as ssrfGuard from '../../src/webhook/ssrf-guard.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Dashboard Web UI & Management API', () => {
  let db: Database.Database;
  let repo: Repository;
  let app: FastifyInstance;
  let authenticateRequest: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = new Repository(db);
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_MASTER_KEY: masterKey,
      CLOUDFLARE_ACCESS_TEAM_NAME: 'test-team',
      CLOUDFLARE_ACCESS_AUD: 'test-audience',
    });

    authenticateRequest = vi.spyOn(auth, 'authenticateRequest').mockImplementation(
      async (req: FastifyRequest, _reply: FastifyReply) => {
        if (['/health', '/live', '/ready', '/metrics'].includes(req.url.split('?')[0])) {
          return true;
        }
        if (req.headers['cf-access-jwt-assertion'] === 'verified-cloudflare-access-jwt') {
          (req as FastifyRequest & { authUser?: string; authMethod?: string }).authUser = 'admin@example.com';
          (req as FastifyRequest & { authUser?: string; authMethod?: string }).authMethod = 'cloudflare_access_jwt';
          return true;
        }
        _reply.status(401).send({ error: 'Cloudflare Access authentication is required.' });
        return false;
      }
    );
    vi.spyOn(ssrfGuard, 'validateWebhookUrl').mockResolvedValue({
      allowed: true,
      resolvedIp: '93.184.215.14',
    });

    app = buildServer(repo, config);
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    db.close();
  });

  it('allows health probes without Cloudflare Access', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects dashboard API requests without a Cloudflare Access assertion', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(401);
  });

  it('allows the management API only after Cloudflare Access JWT verification', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { 'cf-access-jwt-assertion': 'verified-cloudflare-access-jwt' },
    });
    expect(res.statusCode).toBe(200);
    expect(authenticateRequest).toHaveBeenCalled();
    const json = JSON.parse(res.payload);
    expect(json.status).toBe('ok');
    expect(json.database).toBe('healthy');
    expect(json.cloudflareAccess).toEqual({
      email: 'admin@example.com',
      authenticated: true,
    });
    expect(json.gmailAuth).toBeDefined();
  });

  it('does not accept the removed API-key header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { 'cf-access-api-key': 'deprecated-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('performs full CRUD on webhook endpoints via management API', async () => {
    const authHeaders = { 'cf-access-jwt-assertion': 'verified-cloudflare-access-jwt' };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/endpoints',
      headers: authHeaders,
      payload: {
        name: 'Messenger Bot API',
        url: 'https://messenger.example.com/webhook',
        secret: 'whsec_messenger_secret_123',
      },
    });
    expect(createRes.statusCode).toBe(200);
    const created = JSON.parse(createRes.payload);
    expect(created.id).toBeDefined();

    const listRes = await app.inject({ method: 'GET', url: '/api/endpoints', headers: authHeaders });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.payload);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Messenger Bot API');
    expect(list[0].url).toBe('https://messenger.example.com/webhook');
    expect(list[0]).not.toHaveProperty('secret');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/endpoints/${created.id}`,
      headers: authHeaders,
    });
    expect(deleteRes.statusCode).toBe(200);

    const listAfterDeleteRes = await app.inject({ method: 'GET', url: '/api/endpoints', headers: authHeaders });
    expect(JSON.parse(listAfterDeleteRes.payload)).toHaveLength(0);
  });
});
