import crypto from 'node:crypto';
import { google } from 'googleapis';
import { CodeChallengeMethod } from 'google-auth-library';
import type { Config } from '../config.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Repository } from '../db/repository.js';
import { getGoogleOAuthConfig, saveGoogleOAuthConfig } from './oauth-config.js';

const TOKEN_AAD = 'gmail-oauth-token';

export interface GmailOAuthStatus {
  configured: boolean;
  connected: boolean;
  emailAddress: string | null;
  clientId: string | null;
  reconnectRequired: boolean;
}

export class GmailOAuthService {
  constructor(
    private repository: Repository,
    private config: Config
  ) {}

  getStatus(): GmailOAuthStatus {
    let oauth;
    try {
      oauth = getGoogleOAuthConfig(this.repository, this.config);
    } catch {
      return { configured: false, connected: false, emailAddress: null, clientId: null, reconnectRequired: true };
    }
    const connection = this.repository.getGmailConnection();
    return {
      configured: Boolean(oauth),
      connected: Boolean(connection),
      emailAddress: connection?.emailAddress || null,
      clientId: oauth?.clientId || null,
      reconnectRequired: false,
    };
  }

  configure(values: { clientId: string; clientSecret: string; redirectUri: string }): void {
    saveGoogleOAuthConfig(this.repository, this.config, values);
  }

  getConfig() {
    return getGoogleOAuthConfig(this.repository, this.config);
  }

  begin(browserNonce: string, actor: string): string {
    const oauth = getGoogleOAuthConfig(this.repository, this.config);
    if (!oauth) throw new Error('Google OAuth is not configured on this server.');
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    this.repository.createGmailOAuthState({
      stateHash: hash(state),
      browserNonceHash: hash(browserNonce),
      verifierCiphertext: encryptSecret(verifier, this.config.APP_MASTER_KEY, 'gmail-oauth-verifier'),
      actor,
      expiresAt: Date.now() + this.config.GMAIL_OAUTH_STATE_TTL_SECONDS * 1000,
    });
    const client = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret, oauth.redirectUri);
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: ['https://www.googleapis.com/auth/gmail.readonly'],
      state,
      code_challenge: challenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
  }

  async complete(code: string, state: string, browserNonce: string): Promise<{ emailAddress: string }> {
    const record = this.repository.consumeGmailOAuthState(hash(state), hash(browserNonce), Date.now());
    if (!record) throw new Error('OAuth session is invalid, expired, or has already been used.');
    const oauth = getGoogleOAuthConfig(this.repository, this.config);
    if (!oauth) throw new Error('Google OAuth is not configured on this server.');
    const verifier = decryptSecret(record.verifierCiphertext, this.config.APP_MASTER_KEY, 'gmail-oauth-verifier');
    const client = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret, oauth.redirectUri);
    const { tokens } = await client.getToken({ code, codeVerifier: verifier });
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove this app from your Google Account and grant permission again.');
    client.setCredentials(tokens);
    const profile = await google.gmail({ version: 'v1', auth: client }).users.getProfile({ userId: 'me' });
    const emailAddress = profile.data.emailAddress;
    if (!emailAddress) throw new Error('Google did not return the connected mailbox.');
    const existing = this.repository.getGmailConnection();
    if (existing && existing.emailAddress !== emailAddress) {
      throw new Error('This gateway is already connected to a different Gmail mailbox. Disconnect it before changing mailboxes.');
    }
    this.repository.saveGmailConnection({
      emailAddress,
      tokenCiphertext: encryptSecret(JSON.stringify(tokens), this.config.APP_MASTER_KEY, TOKEN_AAD),
      clientId: oauth.clientId,
      connectedAt: new Date().toISOString(),
    });
    return { emailAddress };
  }

  getToken(): Record<string, unknown> | null {
    const connection = this.repository.getGmailConnection();
    if (!connection) return null;
    return JSON.parse(decryptSecret(connection.tokenCiphertext, this.config.APP_MASTER_KEY, TOKEN_AAD));
  }

  saveToken(tokens: Record<string, unknown>): void {
    const connection = this.repository.getGmailConnection();
    if (!connection) return;
    this.repository.saveGmailConnection({
      ...connection,
      tokenCiphertext: encryptSecret(JSON.stringify(tokens), this.config.APP_MASTER_KEY, TOKEN_AAD),
    });
  }

  disconnect(): void {
    this.repository.deleteGmailConnection();
    this.repository.clearGmailOAuthStates();
  }
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
