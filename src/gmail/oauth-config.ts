import type { Config } from '../config.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Repository } from '../db/repository.js';

const CLIENT_SECRET_AAD = 'gmail-oauth-client-secret';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleOAuthConfig(repository: Repository, config: Config): GoogleOAuthConfig | null {
  const stored = repository.getGmailOAuthConfig();
  if (!stored) return null;
  return {
    clientId: stored.clientId,
    clientSecret: decryptSecret(stored.clientSecretCiphertext, config.APP_MASTER_KEY, CLIENT_SECRET_AAD),
    redirectUri: stored.redirectUri,
  };
}

export function saveGoogleOAuthConfig(
  repository: Repository,
  config: Config,
  values: { clientId: string; clientSecret: string; redirectUri: string }
): void {
  repository.saveGmailOAuthConfig({
    clientId: values.clientId,
    clientSecretCiphertext: encryptSecret(values.clientSecret, config.APP_MASTER_KEY, CLIENT_SECRET_AAD),
    redirectUri: values.redirectUri,
  });
}
