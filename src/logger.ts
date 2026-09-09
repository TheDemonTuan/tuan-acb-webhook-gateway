import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-webhook-signature"]',
      'authorization',
      'signature',
      'secret',
      'secret_ciphertext',
      'app_master_key',
      'APP_MASTER_KEY',
      'token',
      'refresh_token',
      'access_token',
      'client_secret',
      'password',
    ],
    censor: '[REDACTED]',
  },
  base: {
    service: 'bank-event-gateway',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
