import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations.js';
import { Repository } from '../../src/db/repository.js';
import { GmailOAuthService } from '../../src/gmail/oauth-service.js';
import { loadConfig } from '../../src/config.js';

const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Gmail OAuth state storage', () => {
  let db: Database.Database;
  let repository: Repository;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    repository = new Repository(db);
  });

  it('consumes each OAuth state only once and only for the same browser nonce', () => {
    repository.createGmailOAuthState({
      stateHash: 'state',
      browserNonceHash: 'nonce',
      verifierCiphertext: 'ciphertext',
      actor: 'admin@example.com',
      expiresAt: Date.now() + 60_000,
    });

    expect(repository.consumeGmailOAuthState('state', 'wrong', Date.now())).toBeNull();
    expect(repository.consumeGmailOAuthState('state', 'nonce', Date.now())).toMatchObject({ actor: 'admin@example.com' });
    expect(repository.consumeGmailOAuthState('state', 'nonce', Date.now())).toBeNull();
  });

  it('encrypts the Gmail refresh token at rest', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_MASTER_KEY: masterKey,
      APP_BASE_URL: 'http://localhost:8090',
    });
    const service = new GmailOAuthService(repository, config);
    repository.saveGmailConnection({
      emailAddress: 'admin@example.com',
      clientId: 'client',
      connectedAt: new Date().toISOString(),
      tokenCiphertext: 'placeholder',
    });
    service.saveToken({ refresh_token: 'sensitive-token', access_token: 'access-token' });

    const raw = repository.getGmailConnection()!;
    expect(raw.tokenCiphertext).not.toContain('sensitive-token');
    expect(service.getToken()).toMatchObject({ refresh_token: 'sensitive-token' });
  });
});
