import dns from 'node:dns/promises';
import net from 'node:net';

export interface SsrfCheckResult {
  allowed: boolean;
  reason?: string;
  resolvedIp?: string;
}

/**
 * Check whether an IPv4 address is in a private, loopback, or reserved range
 */
export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN)) return true;

  const [b0, b1] = parts;

  // 0.0.0.0/8 (This host)
  if (b0 === 0) return true;

  // 10.0.0.0/8 (Private)
  if (b0 === 10) return true;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;

  // 169.254.0.0/16 (Link-local / Cloud metadata: 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12 (Private)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.168.0.0/16 (Private)
  if (b0 === 192 && b1 === 168) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

  // 224.0.0.0/4 (Multicast)
  if (b0 >= 224 && b0 <= 239) return true;

  // 240.0.0.0/4 (Reserved)
  if (b0 >= 240) return true;

  // 255.255.255.255 (Broadcast)
  if (ip === '255.255.255.255') return true;

  return false;
}

/**
 * Check whether an IPv6 address is in a private, loopback, or reserved range
 */
export function isPrivateOrReservedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // ::1 (Loopback)
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  // :: (Unspecified)
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

  // fc00::/7 (Unique local address)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // fe80::/10 (Link-local)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

  // IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.replace('::ffff:', '');
    if (net.isIPv4(ipv4Part)) {
      return isPrivateOrReservedIpv4(ipv4Part);
    }
    return true;
  }

  return false;
}

/**
 * Check if IP is private or reserved
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isPrivateOrReservedIpv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isPrivateOrReservedIpv6(ip);
  }
  return true;
}

/**
 * Validate URL for safe webhook dispatch:
 * - Must be https:
 * - Resolve DNS
 * - Reject any private/reserved/internal IP
 * - Pin resolved IP to prevent DNS rebinding
 */
export async function validateWebhookUrl(targetUrl: string): Promise<SsrfCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { allowed: false, reason: 'Invalid URL format' };
  }

  // Strictly enforce HTTPS
  if (parsed.protocol !== 'https:') {
    return { allowed: false, reason: `Protocol '${parsed.protocol}' is forbidden; only https: is permitted` };
  }

  const hostname = parsed.hostname;

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return { allowed: false, reason: `Direct IP ${hostname} belongs to private or reserved ranges` };
    }
    return { allowed: true, resolvedIp: hostname };
  }

  // Resolve hostname
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      return { allowed: false, reason: `DNS lookup returned no records for ${hostname}` };
    }

    for (const record of records) {
      if (isPrivateOrReservedIp(record.address)) {
        return {
          allowed: false,
          reason: `Hostname ${hostname} resolved to forbidden IP: ${record.address}`,
        };
      }
    }

    // Pick first valid record
    return { allowed: true, resolvedIp: records[0].address };
  } catch (err: any) {
    return { allowed: false, reason: `DNS resolution failed: ${err.message}` };
  }
}
