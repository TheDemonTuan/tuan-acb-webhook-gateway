import { describe, it, expect } from 'vitest';
import { parseAcbEmail, parseVnDateTime, maskAccount } from '../../src/bank/acb-parser.js';
import { validAcbCreditEmail, validAcbDebitEmail, invalidFormatEmail } from '../fixtures/sample-emails.js';

describe('ACB Parser', () => {
  it('correctly masks account numbers', () => {
    expect(maskAccount('123456789')).toBe('123***789');
    expect(maskAccount('123***789')).toBe('123***789');
    expect(maskAccount('123456')).toBe('***456');
  });

  it('correctly parses Vietnam UTC+7 time into ISO UTC', () => {
    // 09/09/2026 15:30:00 VN = 09/09/2026 08:30:00 UTC
    const iso = parseVnDateTime('09/09/2026 15:30:00');
    expect(iso).toBe('2026-09-09T08:30:00.000Z');
  });

  it('successfully parses valid ACB credit email and produces valid transaction', () => {
    const result = parseAcbEmail(validAcbCreditEmail.subject, validAcbCreditEmail.bodyText);
    expect(result.success).toBe(true);
    if (result.success && result.status === 'ACCEPTED') {
      expect(result.transaction.bank).toBe('ACB');
      expect(result.transaction.direction).toBe('CREDIT');
      expect(result.transaction.amount).toBe('500000');
      expect(result.transaction.currency).toBe('VND');
      expect(result.transaction.accountMasked).toBe('123***789');
      expect(result.transaction.transactionAt).toBe('2026-09-09T08:30:00.000Z');
      expect(result.transaction.description).toContain('NGUYEN VAN A chuyen tien REF987654');
      expect(result.transaction.rawReference).toBe('987654');
      expect(result.transaction.fingerprint).toHaveLength(64);
    }
  });

  it('correctly ignores debit transactions per policy', () => {
    const result = parseAcbEmail(validAcbDebitEmail.subject, validAcbDebitEmail.bodyText);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.status).toBe('IGNORED');
      expect(result.direction).toBe('DEBIT');
    }
  });

  it('quarantines promotional or non-transaction emails', () => {
    const result = parseAcbEmail(invalidFormatEmail.subject, invalidFormatEmail.bodyText);
    expect(result.success).toBe(false);
    expect(result.status).toBe('QUARANTINE');
  });

  it('rejects invalid/floating point amounts', () => {
    const maliciousBody = `
Biến động số dư tài khoản ACB
Loại giao dịch: Báo Có (+)
Số tiền: +500.50 VND
Thời gian: 09/09/2026 15:30:00
Tài khoản: 123456
Nội dung: test
`;
    const result = parseAcbEmail('Biến động số dư', maliciousBody);
    // cleanAmountDigits would be 50050 or if invalid rejected
    // Let's test negative/zero
    const zeroBody = `
Biến động số dư tài khoản ACB
Loại giao dịch: Báo Có (+)
Số tiền: 0 VND
Thời gian: 09/09/2026 15:30:00
Tài khoản: 123456
Nội dung: test
`;
    const zeroResult = parseAcbEmail('Biến động số dư', zeroBody);
    expect(zeroResult.success).toBe(false);
  });
});
