import type { ParsedMail } from 'mailparser';

export interface EmailAuthResult {
  accepted: boolean;
  status: 'ACCEPTED' | 'REJECTED' | 'QUARANTINE';
  reason?: string;
  sender?: string;
  spfStatus?: string;
  dkimStatus?: string;
  dmarcStatus?: string;
  dkimDomain?: string;
}

export interface EmailAuthOptions {
  allowedDomains: string[]; // e.g. ['acb.com.vn']
}

/**
 * Verify email authentication headers (SPF, DKIM, DMARC, Domain alignment)
 * specifically inspecting the authenticating Google MX boundary.
 */
export function verifyEmailAuth(
  mail: ParsedMail,
  options: EmailAuthOptions
): EmailAuthResult {
  const fromHeader = mail.from?.value?.[0]?.address?.toLowerCase() || '';
  if (!fromHeader) {
    return {
      accepted: false,
      status: 'REJECTED',
      reason: 'Missing or empty From address header',
    };
  }

  // Extract From domain
  const fromDomainMatch = fromHeader.match(/@([^@>]+)$/);
  if (!fromDomainMatch) {
    return {
      accepted: false,
      status: 'REJECTED',
      reason: 'Invalid email format in From header',
      sender: fromHeader,
    };
  }
  const fromDomain = fromDomainMatch[1].toLowerCase().trim();

  // Validate From domain against allowed list
  const isAllowedDomain = options.allowedDomains.some(
    (allowed) => fromDomain === allowed.toLowerCase() || fromDomain.endsWith(`.${allowed.toLowerCase()}`)
  );
  if (!isAllowedDomain) {
    return {
      accepted: false,
      status: 'REJECTED',
      reason: `From domain '${fromDomain}' is not in allowed bank domains (${options.allowedDomains.join(', ')})`,
      sender: fromHeader,
    };
  }

  // Inspect headers for Authentication-Results
  // Google Gmail places Authentication-Results at the top of incoming messages from mx.google.com
  const rawHeaders = mail.headers;
  const authResultsHeader = rawHeaders.get('authentication-results');

  let authResultsStrings: string[] = [];
  if (Array.isArray(authResultsHeader)) {
    authResultsStrings = authResultsHeader.map((h: any) => (typeof h === 'string' ? h : h.text || ''));
  } else if (typeof authResultsHeader === 'string') {
    authResultsStrings = [authResultsHeader];
  } else if (authResultsHeader && typeof (authResultsHeader as any).text === 'string') {
    authResultsStrings = [(authResultsHeader as any).text];
  }

  // Find the top-most Authentication-Results from mx.google.com
  const googleAuthResult = authResultsStrings.find((h) => h.includes('mx.google.com'));

  if (!googleAuthResult) {
    return {
      accepted: false,
      status: 'QUARANTINE',
      reason: 'No trusted Authentication-Results header found from mx.google.com',
      sender: fromHeader,
    };
  }

  // Parse SPF, DKIM, DMARC statuses from the Google Authentication-Results header
  // Examples:
  // dkim=pass header.i=@acb.com.vn header.s=... header.b=...
  // spf=pass (google.com: domain of ... designates ... as permitted sender)
  // dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=acb.com.vn

  const dkimMatch = googleAuthResult.match(/dkim=([a-zA-Z]+)(?:\s+header\.(?:i|d)=([^\s;]+))?/i);
  const spfMatch = googleAuthResult.match(/spf=([a-zA-Z]+)/i);
  const dmarcMatch = googleAuthResult.match(/dmarc=([a-zA-Z]+)/i);

  const dkimStatus = dkimMatch ? dkimMatch[1].toLowerCase() : 'none';
  let dkimDomain = dkimMatch && dkimMatch[2] ? dkimMatch[2].toLowerCase().replace(/^@/, '') : undefined;
  const spfStatus = spfMatch ? spfMatch[1].toLowerCase() : 'none';
  const dmarcStatus = dmarcMatch ? dmarcMatch[1].toLowerCase() : 'none';

  // Check DKIM domain alignment if present
  if (dkimDomain) {
    // If dkimDomain is full email like foo@acb.com.vn, take domain
    if (dkimDomain.includes('@')) {
      dkimDomain = dkimDomain.split('@')[1];
    }
  }

  // Strict verification criteria:
  // Must have DKIM pass OR (SPF pass AND DMARC pass)
  // And the DKIM domain or From domain must align with allowed bank domains
  const dkimPassed = dkimStatus === 'pass';
  const spfPassed = spfStatus === 'pass';
  const dmarcPassed = dmarcStatus === 'pass';

  const dkimAligned = dkimDomain
    ? options.allowedDomains.some((d) => dkimDomain === d || dkimDomain?.endsWith(`.${d}`))
    : false;

  if (dkimPassed && dkimAligned) {
    return {
      accepted: true,
      status: 'ACCEPTED',
      sender: fromHeader,
      spfStatus,
      dkimStatus,
      dmarcStatus,
      dkimDomain,
    };
  }

  if (spfPassed && dmarcPassed) {
    return {
      accepted: true,
      status: 'ACCEPTED',
      sender: fromHeader,
      spfStatus,
      dkimStatus,
      dmarcStatus,
      dkimDomain,
    };
  }

  // Authentication did not satisfy policy
  return {
    accepted: false,
    status: 'QUARANTINE',
    reason: `Email authentication failed policy: spf=${spfStatus}, dkim=${dkimStatus} (domain=${dkimDomain}), dmarc=${dmarcStatus}`,
    sender: fromHeader,
    spfStatus,
    dkimStatus,
    dmarcStatus,
    dkimDomain,
  };
}
