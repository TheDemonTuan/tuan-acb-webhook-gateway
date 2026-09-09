#!/usr/bin/env node
import { Command } from 'commander';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { google } from 'googleapis';
import { loadConfig } from './config.js';
import { initDatabase, closeDatabase } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { Repository } from './db/repository.js';
import { encryptSecret } from './crypto.js';
import { GmailService } from './gmail/client.js';

const program = new Command();

program
  .name('bank-gateway')
  .description('Operational CLI for Standalone Bank Event Gateway')
  .version('1.0.0');

// Command: migrate
program
  .command('migrate')
  .description('Run SQLite database schema migrations')
  .action(() => {
    const config = loadConfig();
    const db = initDatabase(config.DATABASE_PATH);
    try {
      runMigrations(db);
      console.log('Migrations applied successfully.');
    } finally {
      closeDatabase();
    }
  });

// Command: bootstrap-token
program
  .command('bootstrap-token')
  .description('Interactive OAuth2 helper to authorize Gmail API and save tokens')
  .action(async () => {
    const config = loadConfig();
    if (!fs.existsSync(config.GMAIL_CREDENTIALS_PATH)) {
      console.error(`Credentials file not found at ${config.GMAIL_CREDENTIALS_PATH}`);
      process.exit(1);
    }

    const raw = fs.readFileSync(config.GMAIL_CREDENTIALS_PATH, 'utf8');
    const creds = JSON.parse(raw);
    const clientDetails = creds.installed || creds.web;
    if (!clientDetails) {
      console.error('Invalid credentials format: missing installed/web property');
      process.exit(1);
    }

    const { client_id, client_secret, redirect_uris } = clientDetails;
    const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    });

    console.log('\nAuthorize this application by visiting this URL:');
    console.log(authUrl);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('\nEnter the authorization code from that page: ', async (code) => {
      rl.close();
      try {
        const { tokens } = await oAuth2Client.getToken(code.trim());
        const tokenDir = path.dirname(config.GMAIL_TOKEN_PATH);
        if (!fs.existsSync(tokenDir)) {
          fs.mkdirSync(tokenDir, { recursive: true });
        }
        fs.writeFileSync(config.GMAIL_TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
        console.log(`Token saved successfully to ${config.GMAIL_TOKEN_PATH}`);
      } catch (err: any) {
        console.error('Error exchanging authorization code:', err.message);
        process.exit(1);
      }
    });
  });

// Command: watch-renew
program
  .command('watch-renew')
  .description('Renew Gmail push notification watch on Google Pub/Sub')
  .action(async () => {
    const config = loadConfig();
    if (!config.PUBSUB_TOPIC_NAME) {
      console.error('PUBSUB_TOPIC_NAME is required in configuration to register Gmail watch');
      process.exit(1);
    }

    const db = initDatabase(config.DATABASE_PATH);
    const repo = new Repository(db);
    const gmailService = new GmailService(config);

    try {
      await gmailService.init();
      const res = await gmailService.watch(config.PUBSUB_TOPIC_NAME);
      repo.setGmailState({
        mailboxId: config.GMAIL_MAILBOX_ID,
        lastHistoryId: res.historyId,
        watchExpirationAt: res.expiration,
        updatedAt: new Date().toISOString(),
      });
      console.log(`Watch registered successfully! Expiration: ${new Date(res.expiration).toISOString()}, History ID: ${res.historyId}`);
    } finally {
      closeDatabase();
    }
  });

// Command: endpoint
const endpointCmd = program.command('endpoint').description('Manage webhook destinations');

endpointCmd
  .command('add <name> <url> <secret> [filter]')
  .description('Register a new webhook endpoint with encrypted secret')
  .action((name, url, secret, filter) => {
    const config = loadConfig();
    const db = initDatabase(config.DATABASE_PATH);
    const repo = new Repository(db);

    try {
      const id = `ep_${crypto.randomUUID()}`;
      const secretCiphertext = encryptSecret(secret, config.APP_MASTER_KEY, id);

      let filterJson: string | undefined;
      if (filter) {
        filterJson = JSON.stringify(filter.split(',').map((s: string) => s.trim()));
      }

      repo.addWebhookEndpoint({
        id,
        name,
        url,
        secretCiphertext,
        eventFilterJson: filterJson,
        timeoutMs: config.WEBHOOK_TIMEOUT_MS,
      });

      console.log(`Endpoint added successfully: ID=${id}, Name=${name}, URL=${url}`);
    } finally {
      closeDatabase();
    }
  });

endpointCmd
  .command('list')
  .description('List all registered webhook endpoints')
  .action(() => {
    const config = loadConfig();
    const db = initDatabase(config.DATABASE_PATH);
    const repo = new Repository(db);

    try {
      const endpoints = repo.listWebhookEndpoints();
      console.table(
        endpoints.map((e) => ({
          ID: e.id,
          Name: e.name,
          URL: e.url,
          Enabled: e.enabled ? 'YES' : 'NO',
          Timeout: `${e.timeoutMs}ms`,
          Created: e.createdAt,
        }))
      );
    } finally {
      closeDatabase();
    }
  });

endpointCmd
  .command('toggle <id> <status>')
  .description('Enable or disable a webhook endpoint (status: enable|disable)')
  .action((id, status) => {
    const config = loadConfig();
    const db = initDatabase(config.DATABASE_PATH);
    const repo = new Repository(db);

    try {
      const isEnable = status.toLowerCase() === 'enable' || status === '1' || status === 'true';
      repo.toggleWebhookEndpoint(id, isEnable);
      console.log(`Endpoint ${id} status updated to: ${isEnable ? 'ENABLED' : 'DISABLED'}`);
    } finally {
      closeDatabase();
    }
  });

// Command: replay
program
  .command('replay <deliveryId>')
  .description('Manually re-queue a dead-lettered or failed webhook delivery')
  .action((deliveryId) => {
    const config = loadConfig();
    const db = initDatabase(config.DATABASE_PATH);
    const repo = new Repository(db);

    try {
      const nowIso = new Date().toISOString();
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
        .run(nowIso, nowIso, deliveryId);

      if (res.changes === 0) {
        console.error(`Delivery with ID ${deliveryId} not found.`);
        process.exit(1);
      }

      repo.logAudit({
        entityType: 'WEBHOOK_DELIVERY',
        entityId: deliveryId,
        action: 'MANUAL_REPLAY',
        actor: process.env.USER || process.env.USERNAME || 'operator',
      });

      console.log(`Delivery ${deliveryId} successfully reset to PENDING.`);
    } finally {
      closeDatabase();
    }
  });

// Command: backup
program
  .command('backup <destPath>')
  .description('Perform a clean, consistent online SQLite backup')
  .action(async (destPath) => {
    const config = loadConfig();
    const db = initDatabase(config.DATABASE_PATH);

    try {
      const resolvedDest = path.resolve(destPath);
      const destDir = path.dirname(resolvedDest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      console.log(`Starting online backup to ${resolvedDest}...`);
      await db.backup(resolvedDest);
      console.log('Online backup completed successfully.');
    } finally {
      closeDatabase();
    }
  });

program.parse(process.argv);
