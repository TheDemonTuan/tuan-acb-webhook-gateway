import fs from 'node:fs';
import type { Config } from '../config.js';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface CredentialFile {
  web?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
}

export function getGoogleOAuthConfig(config: Config): GoogleOAuthConfig | null {
  const hasEnvId = Boolean(config.GOOGLE_OAUTH_CLIENT_ID);
  const hasEnvSecret = Boolean(config.GOOGLE_OAUTH_CLIENT_SECRET);
  if (hasEnvId || hasEnvSecret) {
    if (!hasEnvId || !hasEnvSecret) {
      throw new Error('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured together.');
    }
    return {
      clientId: config.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirectUri: config.GOOGLE_OAUTH_REDIRECT_URI || `${config.APP_BASE_URL}/api/gmail/oauth2callback`,
    };
  }

  if (!fs.existsSync(config.GMAIL_CREDENTIALS_PATH)) return null;
  const parsed = JSON.parse(fs.readFileSync(config.GMAIL_CREDENTIALS_PATH, 'utf8')) as CredentialFile;
  const client = parsed.web;
  if (!client?.client_id || !client.client_secret) {
    throw new Error('Gmail credentials must contain a web OAuth client with client_id and client_secret.');
  }
  const redirectUri = config.GOOGLE_OAUTH_REDIRECT_URI || client.redirect_uris?.[0] || `${config.APP_BASE_URL}/api/gmail/oauth2callback`;
  return { clientId: client.client_id, clientSecret: client.client_secret, redirectUri };
}
