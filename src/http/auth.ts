import type { FastifyRequest, FastifyReply } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../config.js';
import { logger } from '../logger.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export interface AuthContext {
  authenticated: boolean;
  user?: string;
  method?: 'api_key' | 'cloudflare_access_jwt';
}

/**
 * Extract auth token or API key from headers, cookies, or query
 */
export function extractClientToken(req: FastifyRequest): string | null {
  // 1. Check custom header cf-access-api-key (case-insensitive)
  const rawHeaders = req.headers;
  for (const [key, val] of Object.entries(rawHeaders)) {
    if (key.toLowerCase() === 'cf-access-api-key' && typeof val === 'string') {
      return val.trim();
    }
  }

  // 2. Check Authorization Bearer
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  // 3. Check cookies
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      const [name, val] = c.split('=');
      if (
        (name.toLowerCase() === 'cf_access_token' ||
          name.toLowerCase() === 'cf-access-api-key' ||
          name.toLowerCase() === 'auth_token') &&
        val
      ) {
        return decodeURIComponent(val.trim());
      }
    }
  }

  // 4. Check query parameter
  const query = req.query as Record<string, string> | undefined;
  if (query?.key) return query.key.trim();
  if (query?.token) return query.token.trim();

  return null;
}

/**
 * Verify authentication for web dashboard and management API routes
 */
export async function authenticateRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  config: Config
): Promise<boolean> {
  // Always allow health and live checks without auth
  const path = req.url.split('?')[0];
  if (path === '/health' || path === '/live') {
    return true;
  }

  // Check Cloudflare Access JWT Assertion header if present
  const cfJwt = req.headers['cf-access-jwt-assertion'] as string | undefined;
  if (cfJwt && config.CLOUDFLARE_ACCESS_TEAM_NAME && config.CLOUDFLARE_ACCESS_AUD) {
    try {
      if (!jwks) {
        const certsUrl = new URL(
          `https://${config.CLOUDFLARE_ACCESS_TEAM_NAME}.cloudflareaccess.com/cdn-cgi/access/certs`
        );
        jwks = createRemoteJWKSet(certsUrl);
      }

      const { payload } = await jwtVerify(cfJwt, jwks, {
        audience: config.CLOUDFLARE_ACCESS_AUD,
        issuer: `https://${config.CLOUDFLARE_ACCESS_TEAM_NAME}.cloudflareaccess.com`,
      });

      const email = (payload.email as string) || (payload.sub as string) || 'cf-user';
      (req as any).authUser = email;
      (req as any).authMethod = 'cloudflare_access_jwt';
      return true;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Cloudflare Access JWT verification failed');
    }
  }

  // Check API Key token
  const providedKey = extractClientToken(req);
  const expectedKey = config.CLOUDFLARE_ACCESS_API_KEY.trim();

  if (providedKey && providedKey === expectedKey) {
    (req as any).authUser = 'admin-api-key';
    (req as any).authMethod = 'api_key';
    return true;
  }

  // For API endpoints, return 401 JSON
  if (path.startsWith('/api/')) {
    reply.status(401).send({
      error: 'Unauthorized. Provide cf-access-api-key header or authenticate via Cloudflare Access.',
    });
    return false;
  }

  // For UI routes, allow rendering the page so the client-side login screen can prompt for the key
  return true;
}
