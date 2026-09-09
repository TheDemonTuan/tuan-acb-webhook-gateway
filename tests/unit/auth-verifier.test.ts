import { describe, it, expect } from 'vitest';
import { verifyEmailAuth } from '../../src/email/auth-verifier.js';
import type { ParsedMail } from 'mailparser';

describe('Email Auth Verifier', () => {
  const allowedDomains = ['acb.com.vn'];

  it('accepts legitimate email with Google mx.google.com authentication-results passing DKIM', () => {
    const fakeMail = {
      from: { value: [{ address: 'contact@acb.com.vn' }] },
      headers: new Map([
        [
          'authentication-results',
          'mx.google.com; dkim=pass header.i=@acb.com.vn header.s=s1; spf=pass; dmarc=pass action=none header.from=acb.com.vn',
        ],
      ]),
    } as unknown as ParsedMail;

    const result = verifyEmailAuth(fakeMail, { allowedDomains });
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('ACCEPTED');
    expect(result.dkimStatus).toBe('pass');
    expect(result.dkimDomain).toBe('acb.com.vn');
  });

  it('rejects email from unapproved sender domain', () => {
    const fakeMail = {
      from: { value: [{ address: 'scam@phishing.com' }] },
      headers: new Map([
        [
          'authentication-results',
          'mx.google.com; dkim=pass header.i=@phishing.com; spf=pass',
        ],
      ]),
    } as unknown as ParsedMail;

    const result = verifyEmailAuth(fakeMail, { allowedDomains });
    expect(result.accepted).toBe(false);
    expect(result.status).toBe('REJECTED');
  });

  it('quarantines email without trusted mx.google.com header', () => {
    const fakeMail = {
      from: { value: [{ address: 'alert@acb.com.vn' }] },
      headers: new Map([
        [
          'authentication-results',
          'mx.attacker-relay.com; dkim=pass header.i=@acb.com.vn',
        ],
      ]),
    } as unknown as ParsedMail;

    const result = verifyEmailAuth(fakeMail, { allowedDomains });
    expect(result.accepted).toBe(false);
    expect(result.status).toBe('QUARANTINE');
    expect(result.reason).toContain('No trusted Authentication-Results header found');
  });

  it('quarantines email when DKIM fails or domain is not aligned', () => {
    const fakeMail = {
      from: { value: [{ address: 'alert@acb.com.vn' }] },
      headers: new Map([
        [
          'authentication-results',
          'mx.google.com; dkim=fail header.i=@acb.com.vn; spf=fail; dmarc=fail',
        ],
      ]),
    } as unknown as ParsedMail;

    const result = verifyEmailAuth(fakeMail, { allowedDomains });
    expect(result.accepted).toBe(false);
    expect(result.status).toBe('QUARANTINE');
  });
});
