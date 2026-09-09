import { sha256 } from '../crypto.js';

export interface ParsedBankTransaction {
  bank: 'ACB';
  direction: 'CREDIT' | 'DEBIT';
  amount: string; // clean integer string in VND
  currency: 'VND';
  accountMasked: string;
  description: string;
  transactionAt: string; // ISO 8601 string
  fingerprint: string;
  rawReference?: string;
}

export type ParseResult =
  | {
      success: true;
      status: 'ACCEPTED';
      transaction: ParsedBankTransaction;
    }
  | {
      success: true;
      status: 'IGNORED';
      direction: 'DEBIT';
      reason: string;
    }
  | {
      success: false;
      status: 'QUARANTINE' | 'REJECTED';
      error: string;
    };

export const ACB_PARSER_VERSION = '2026-09-09.1';

/**
 * Normalize and clean Vietnamese text or description
 */
function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mask account number for security compliance (keep first 3 and last 3 digits)
 */
export function maskAccount(account: string): string {
  const clean = account.replace(/[\s-]/g, '');
  if (clean.includes('*')) {
    return clean;
  }
  if (clean.length <= 6) {
    return '***' + clean.slice(-3);
  }
  return clean.slice(0, 3) + '***' + clean.slice(-3);
}

/**
 * Parse Date in Asia/Ho_Chi_Minh (UTC+7) timezone
 * Format: DD/MM/YYYY HH:mm:ss or DD/MM/YYYY HH:mm or DD-MM-YYYY...
 */
export function parseVnDateTime(dateTimeStr: string): string | null {
  const match = dateTimeStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[ ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // 0-indexed
  const year = parseInt(match[3], 10);
  const hour = match[4] ? parseInt(match[4], 10) : 0;
  const minute = match[5] ? parseInt(match[5], 10) : 0;
  const second = match[6] ? parseInt(match[6], 10) : 0;

  // Construct UTC date accounting for UTC+7 (Vietnam time)
  // Vietnam is UTC+7 all year round (no DST).
  // Time in UTC = Time in VN - 7 hours
  const utcMillis = Date.UTC(year, month, day, hour - 7, minute, second);
  const dateObj = new Date(utcMillis);

  if (Number.isNaN(dateObj.getTime())) {
    return null;
  }

  return dateObj.toISOString();
}

/**
 * Deterministic parser for ACB Email Notifications
 */
export function parseAcbEmail(
  subject: string,
  bodyText: string,
  receivedAtFallback?: string
): ParseResult {
  const combined = `${subject}\n${bodyText}`;

  // 1. Check if this is an ACB transaction notification
  const isAcbAlert = 
    /biến động số dư/i.test(combined) ||
    /bien dong so du/i.test(combined) ||
    /báo có/i.test(combined) ||
    /bao co/i.test(combined) ||
    /giao dịch/i.test(combined) ||
    /giao dich/i.test(combined);

  if (!isAcbAlert) {
    return {
      success: false,
      status: 'QUARANTINE',
      error: 'Email does not match ACB transaction notification patterns',
    };
  }

  // 2. Detect Direction: CREDIT vs DEBIT
  let direction: 'CREDIT' | 'DEBIT' | null = null;

  if (/\b(?:báo nợ|bao no|chi tiền|thanh toán|chuyển đi)\b/i.test(combined)) {
    direction = 'DEBIT';
  } else if (/\b(?:báo có|bao co|nhận tiền|chuyển đến)\b/i.test(combined)) {
    direction = 'CREDIT';
  }

  // 3. Extract Amount
  // Matches e.g.: "Số tiền giao dịch: +500,000 VND" or "Số tiền: 500.000 đ"
  const amountRegex = /(?:Số tiền(?: giao dịch)?|Biến động|So tien|Giao dich)[^\r\n\d+\-]*([+\-]?[ ]*[\d,.]+)[ ]*(?:VND|VNĐ|đ|d)?/i;
  const amountMatch = combined.match(amountRegex);

  let rawAmountStr = '';
  if (amountMatch) {
    rawAmountStr = amountMatch[1].trim();
  } else {
    // Fallback look for "+ 500,000 VND" or "- 50,000 VND"
    const standaloneAmountMatch = combined.match(/([+\-][ ]*[\d,.]+)[ ]*(?:VND|VNĐ|đ|d)\b/i);
    if (standaloneAmountMatch) {
      rawAmountStr = standaloneAmountMatch[1].trim();
    }
  }

  if (!rawAmountStr) {
    return {
      success: false,
      status: 'QUARANTINE',
      error: 'Could not detect transaction amount',
    };
  }

  // Check sign in amount string if direction wasn't decided yet
  if (rawAmountStr.startsWith('+')) {
    direction = 'CREDIT';
  } else if (rawAmountStr.startsWith('-')) {
    direction = 'DEBIT';
  }

  // Default to CREDIT if not explicitly DEBIT and contains credit keywords
  if (!direction) {
    direction = 'CREDIT';
  }

  // If this is a DEBIT transaction, ignore per policy (V1 only handles incoming CREDIT)
  if (direction === 'DEBIT') {
    return {
      success: true,
      status: 'IGNORED',
      direction: 'DEBIT',
      reason: 'Debit transactions are ignored per policy (only incoming CREDIT is processed)',
    };
  }

  // Clean amount: remove +, -, commas, dots, spaces
  const cleanAmountDigits = rawAmountStr.replace(/[+\-\s,.]/g, '');
  if (!/^[1-9]\d*$/.test(cleanAmountDigits)) {
    return {
      success: false,
      status: 'QUARANTINE',
      error: `Invalid amount detected: "${rawAmountStr}" -> "${cleanAmountDigits}" (must be positive integer VND)`,
    };
  }

  // 4. Extract Account Number (requires 4 to 24 numeric/masked digits to avoid matching words like "ACB")
  const accountRegex = /(?:Số tài khoản|Tài khoản|Tai khoan|So tai khoan)[^\r\n0-9*]*([0-9*]{4,24})/i;
  const accountMatch = combined.match(accountRegex);
  const rawAccount = accountMatch ? accountMatch[1].trim() : 'UNKNOWN';
  const accountMasked = maskAccount(rawAccount);

  // 5. Extract Transaction Date & Time
  // Explicit format: DD/MM/YYYY HH:mm:ss or DD-MM-YYYY HH:mm:ss
  const explicitDateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}(?:[ ]+\d{1,2}:\d{2}(?::\d{2})?)?)/;
  const dateMatch = combined.match(explicitDateRegex);

  let transactionAtIso: string | null = null;
  if (dateMatch) {
    transactionAtIso = parseVnDateTime(dateMatch[1].trim());
  }

  if (!transactionAtIso && receivedAtFallback) {
    const fallbackDate = new Date(receivedAtFallback);
    if (!Number.isNaN(fallbackDate.getTime())) {
      transactionAtIso = fallbackDate.toISOString();
    }
  }

  if (!transactionAtIso) {
    return {
      success: false,
      status: 'QUARANTINE',
      error: 'Could not extract valid transaction date/time',
    };
  }

  // 6. Extract Description / Content
  const descRegex = /(?:Nội dung(?: GD)?|Diễn giải|Noi dung|Lý do)[^\r\n:]*:?[ ]*([^\r\n]+)/i;
  const descMatch = combined.match(descRegex);
  const description = descMatch ? normalizeText(descMatch[1]) : '';

  // Extract reference code if present (e.g. "REF987654" or "FT123456")
  const refMatch = description.match(/\b(?:REF|GD|FT|MGD)[\s:]*([A-Za-z0-9]+)\b/i);
  const rawReference = refMatch ? refMatch[1] : undefined;

  // 7. Generate Fingerprint
  const normalizedDescForFp = description.toLowerCase().replace(/[^a-z0-9]/g, '');
  const fingerprint = sha256(`ACB:CREDIT:${cleanAmountDigits}:${normalizedDescForFp}:${transactionAtIso}`);

  return {
    success: true,
    status: 'ACCEPTED',
    transaction: {
      bank: 'ACB',
      direction: 'CREDIT',
      amount: cleanAmountDigits,
      currency: 'VND',
      accountMasked,
      description,
      transactionAt: transactionAtIso,
      fingerprint,
      rawReference,
    },
  };
}
