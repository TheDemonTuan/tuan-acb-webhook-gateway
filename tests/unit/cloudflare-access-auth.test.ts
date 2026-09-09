import { beforeEach, describe, expect, it, vi } from 'vitest';

const jose = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => 'cloudflare-jwks'),
}));

vi.mock('jose', () => jose);

import { authenticateRequest } from '../../src/http/auth.js';
import type { Config } from '../../src/config.js';

const config = {
  CLOUDFLARE_ACCESS_TEAM_NAME: 'test-team',
  CLOUDFLARE_ACCESS_AUD: 'test-audience',
} as Config;

function request(path: string, headers: Record<string, string> = {}) {
  return { url: path, headers } as any;
}

function reply() {
  const result = { status: vi.fn(), send: vi.fn() };
  result.status.mockReturnValue(result);
  return result as any;
}

describe('Cloudflare Access origin authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows local readiness probes without an assertion', async () => {
    const res = reply();
    await expect(authenticateRequest(request('/ready'), res, config)).resolves.toBe(true);
    expect(jose.jwtVerify).not.toHaveBeenCalled();
  });

  it('validates the Cloudflare assertion signature, issuer, and audience', async () => {
    jose.jwtVerify.mockResolvedValueOnce({ payload: { email: 'admin@example.com' } });
    const req = request('/api/status', { 'cf-access-jwt-assertion': 'signed-assertion' });
    const res = reply();

    await expect(authenticateRequest(req, res, config)).resolves.toBe(true);
    expect(jose.jwtVerify).toHaveBeenCalledWith('signed-assertion', 'cloudflare-jwks', {
      audience: 'test-audience',
      issuer: 'https://test-team.cloudflareaccess.com',
    });
    expect(req.authUser).toBe('admin@example.com');
    expect(req.authMethod).toBe('cloudflare_access_jwt');
  });

  it('fails closed for an invalid assertion or a removed API-key header', async () => {
    jose.jwtVerify.mockRejectedValueOnce(new Error('invalid signature'));
    const res = reply();

    await expect(
      authenticateRequest(
        request('/api/status', {
          'cf-access-jwt-assertion': 'invalid-assertion',
          'cf-access-api-key': 'must-not-authenticate',
        }),
        res,
        config
      )
    ).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({ error: 'Cloudflare Access authentication is required.' });
  });
});
