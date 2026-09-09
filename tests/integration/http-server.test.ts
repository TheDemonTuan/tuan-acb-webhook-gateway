import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations.js';
import { Repository } from '../../src/db/repository.js';
import { buildServer } from '../../src/http/server.js';
import { loadConfig } from '../../src/config.js';
import type { FastifyInstance } from 'fastify';

describe('HTTP Server Integration', () => {
  let db: Database.Database;
  let repo: Repository;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    repo = new Repository(db);
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    app = buildServer(repo, config);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('responds 200 on /health and /live', async () => {
    const resHealth = await app.inject({ method: 'GET', url: '/health' });
    expect(resHealth.statusCode).toBe(200);
    const jsonHealth = JSON.parse(resHealth.payload);
    expect(jsonHealth.status).toBe('ok');

    const resLive = await app.inject({ method: 'GET', url: '/live' });
    expect(resLive.statusCode).toBe(200);
  });

  it('responds 200 on /ready with database status', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe('ready');
    expect(json.database).toBe('healthy');
    expect(json.queue).toBeDefined();
  });

  it('responds 200 on /metrics with queue and memory metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.queue).toBeDefined();
    expect(json.memory).toBeDefined();
    expect(json.endpointsCount).toBe(0);
  });
});
