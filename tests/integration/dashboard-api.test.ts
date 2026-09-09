import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations.js';
import { Repository } from '../../src/db/repository.js';
import { buildServer } from '../../src/http/server.js';
import { loadConfig } from '../../src/config.js';
import * as ssrfGuard from '../../src/webhook/ssrf-guard.js';
import type { FastifyInstance } from 'fastify';

describe('Dashboard Web UI & Management API', () => {
  let db: Database.Database;
  let repo: Repository;
  let app: FastifyInstance;
  const accessKey = 'test_cloudflare_access_api_key_12345';

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = new Repository(db);
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      CLOUDFLARE_ACCESS_API_KEY: accessKey,
    });

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

  it('renders dashboard HTML at root /', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('Bank Event Gateway');
    expect(res.payload).toContain('ACB Email');
  });

  it('rejects unauthenticated requests to /api/ with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.payload);
    expect(json.error).toContain('Unauthorized');
  });

  it('allows access to /api/status with cf-access-api-key header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: {
        'cf-access-api-key': accessKey,
      },
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe('ok');
    expect(json.database).toBe('healthy');
    expect(json.gmailAuth).toBeDefined();
  });

  it('allows access with cookie cf_access_token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: {
        cookie: `cf_access_token=${accessKey}`,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('performs full CRUD on webhook endpoints via management API', async () => {
    const authHeaders = { 'cf-access-api-key': accessKey };

    // 1. Create Endpoint
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

    // 2. List Endpoints
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/endpoints',
      headers: authHeaders,
    });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.payload);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Messenger Bot API');
    expect(list[0].enabled).toBe(true);

    // 3. Toggle Disable
    const toggleRes = await app.inject({
      method: 'PATCH',
      url: `/api/endpoints/${created.id}/toggle`,
      headers: authHeaders,
      payload: { enabled: false },
    });
    expect(toggleRes.statusCode).toBe(200);

    const listAfterToggle = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/endpoints', headers: authHeaders })).payload
    );
    expect(listAfterToggle[0].enabled).toBe(false);

    // 4. Delete Endpoint
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/endpoints/${created.id}`,
      headers: authHeaders,
    });
    expect(deleteRes.statusCode).toBe(200);

    const listAfterDelete = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/endpoints', headers: authHeaders })).payload
    );
    expect(listAfterDelete).toHaveLength(0);
  });
});
