import { describe, it, expect } from 'vitest';
import { isPrivateOrReservedIp, validateWebhookUrl } from '../../src/webhook/ssrf-guard.js';

describe('SSRF Guard', () => {
  it('identifies private, loopback, and metadata IPv4 addresses', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.100')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
    expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true); // CGNAT
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false); // Google Public DNS
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false); // Cloudflare DNS
  });

  it('identifies private, loopback, and IPv4-mapped IPv6 addresses', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('rejects non-https URLs', async () => {
    const res = await validateWebhookUrl('http://api.example.com/webhook');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('only https: is permitted');
  });

  it('rejects direct private IPs in https URLs', async () => {
    const res = await validateWebhookUrl('https://127.0.0.1:8000/webhook');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('private or reserved');
  });

  it('rejects loopback hostnames like localhost', async () => {
    const res = await validateWebhookUrl('https://localhost/webhook');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('forbidden IP');
  });
});
