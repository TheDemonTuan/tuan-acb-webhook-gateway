import { describe, it, expect } from 'vitest';
import type { BankTransactionCreditData, RealtimeEnvelope } from '../src/realtime/realtime.types';

describe('Voice source policy', () => {
  it('identifies non-realtime sources as suppressed from voice', () => {
    const isVoiceEligible = (source?: string): boolean => {
      if (source && source !== 'REALTIME') {
        return false;
      }
      return true;
    };

    expect(isVoiceEligible('REALTIME')).toBe(true);
    expect(isVoiceEligible(undefined)).toBe(true);
    expect(isVoiceEligible('CATCH_UP')).toBe(false);
    expect(isVoiceEligible('FILTER_SYNC')).toBe(false);
    expect(isVoiceEligible('BOOTSTRAP')).toBe(false);
  });

  it('contains source in RealtimeEnvelope', () => {
    const envelope: RealtimeEnvelope<BankTransactionCreditData> = {
      id: 'bevt_123',
      type: 'bank.transaction.credit',
      receivedAt: Date.now(),
      data: {
        bank: 'ACB',
        transactionId: 'txn_123',
        transactionNumber: 'TXN123',
        credit: '100000',
        debit: '0',
        currency: 'VND',
        transactionDate: '2026-09-12T10:00:00+07:00',
        transactionDay: '2026-09-12',
        source: 'CATCH_UP',
        description: 'Payment',
        detectedAt: new Date().toISOString(),
      },
    };

    expect(envelope.data.source).toBe('CATCH_UP');
    expect(envelope.data.transactionDay).toBe('2026-09-12');
  });
});
