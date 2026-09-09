import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../config.js';
import { logger } from '../logger.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTeamName: string | null = null;

export interface AuthContext {
  authenticated: boolean;
  user?: string;
  method?: 'cloudflare_access_jwt';
}

function getAccessAssertion(req: FastifyRequest): string | null {
  const assertion = req.headers['cf-access-jwt-assertion'];
  if (typeof assertion !== 'string' || !assertion.trim()) {
    return null;
  }

  return assertion.trim();
}

function getJwks(teamName: string): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks || jwksTeamName !== teamName) {
    jwks = createRemoteJWKSet(
      new URL(`https://${teamName}.cloudflareaccess.com/cdn-cgi/access/certs`)
    );
    jwksTeamName = teamName;
  }

  return jwks;
}

/**
 * Verify the signed assertion injected by Cloudflare Access at the tunnel origin.
 */
export async function authenticateRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  config: Config
): Promise<boolean> {
  const path = req.url.split('?')[0];
  if (path === '/health' || path === '/live' || path === '/ready') {
    return true;
  }

  const assertion = getAccessAssertion(req);
  if (assertion) {
    try {
      const { payload } = await jwtVerify(assertion, getJwks(config.CLOUDFLARE_ACCESS_TEAM_NAME), {
        audience: config.CLOUDFLARE_ACCESS_AUD,
        issuer: `https://${config.CLOUDFLARE_ACCESS_TEAM_NAME}.cloudflareaccess.com`,
      });

      const user = typeof payload.email === 'string'
        ? payload.email
        : typeof payload.sub === 'string'
          ? payload.sub
          : 'cloudflare-access-user';
      (req as FastifyRequest & { authUser?: string; authMethod?: string }).authUser = user;
      (req as FastifyRequest & { authUser?: string; authMethod?: string }).authMethod =
        'cloudflare_access_jwt';
      return true;
    } catch (err) {
      logger.warn({ err }, 'Cloudflare Access JWT verification failed');
    }
  }

  reply.status(401).send({
    error: 'Cloudflare Access authentication is required.',
  });
  return false;
}
