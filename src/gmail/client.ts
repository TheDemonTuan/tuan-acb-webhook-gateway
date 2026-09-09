import { google, type gmail_v1 } from 'googleapis';
import fs from 'node:fs';
import { logger } from '../logger.js';
import type { Config } from '../config.js';
import { getGoogleOAuthConfig } from './oauth-config.js';
import type { GmailOAuthService } from './oauth-service.js';

export class GmailService {
  private gmail: gmail_v1.Gmail | null = null;
  private oauth2Client: any = null;

  constructor(
    private config: Config,
    private oauthService?: GmailOAuthService
  ) {}

  async init(): Promise<void> {
    if (this.gmail) return;

    const oauth = getGoogleOAuthConfig(this.config);
    if (!oauth) throw new Error('Google OAuth is not configured.');
    const token = this.oauthService?.getToken() || this.readLegacyToken();
    if (!token) throw new Error('Gmail is not connected.');

    this.oauth2Client = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret, oauth.redirectUri);
    this.oauth2Client.setCredentials(token);
    this.oauth2Client.on('tokens', (newTokens: any) => {
      logger.info('Gmail OAuth token refreshed');
      const updated = { ...token, ...newTokens };
      if (this.oauthService) this.oauthService.saveToken(updated);
      else fs.writeFileSync(this.config.GMAIL_TOKEN_PATH, JSON.stringify(updated, null, 2), { mode: 0o600 });
    });
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    logger.info('Gmail API client initialized successfully');
  }

  reset(): void {
    this.gmail = null;
    this.oauth2Client = null;
  }

  private readLegacyToken(): Record<string, unknown> | null {
    if (!fs.existsSync(this.config.GMAIL_TOKEN_PATH)) return null;
    return JSON.parse(fs.readFileSync(this.config.GMAIL_TOKEN_PATH, 'utf8'));
  }

  getClient(): gmail_v1.Gmail {
    if (!this.gmail) {
      throw new Error('Gmail client not initialized');
    }
    return this.gmail;
  }

  async watch(topicName: string): Promise<{ historyId: string; expiration: number }> {
    const gmail = this.getClient();
    const res = await gmail.users.watch({
      userId: this.config.GMAIL_MAILBOX_ID,
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
      },
    });

    return {
      historyId: res.data.historyId || '',
      expiration: parseInt(res.data.expiration || '0', 10),
    };
  }

  async stopWatch(): Promise<void> {
    const gmail = this.getClient();
    await gmail.users.stop({ userId: this.config.GMAIL_MAILBOX_ID });
  }

  async getLatestHistoryId(): Promise<string> {
    const gmail = this.getClient();
    const res = await gmail.users.getProfile({ userId: this.config.GMAIL_MAILBOX_ID });
    return res.data.historyId || '';
  }

  async getRawMessage(messageId: string): Promise<{ raw: Buffer; internalDate?: string }> {
    const gmail = this.getClient();
    const res = await gmail.users.messages.get({
      userId: this.config.GMAIL_MAILBOX_ID,
      id: messageId,
      format: 'raw',
    });

    const rawBase64 = res.data.raw || '';
    // Gmail returns websafe base64 (replace - with +, _ with /)
    const base64 = rawBase64.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(base64, 'base64');

    return {
      raw: buffer,
      internalDate: res.data.internalDate ? new Date(parseInt(res.data.internalDate, 10)).toISOString() : undefined,
    };
  }
}
