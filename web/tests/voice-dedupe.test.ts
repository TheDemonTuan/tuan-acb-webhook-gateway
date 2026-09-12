import { beforeEach, describe, expect, it } from 'vitest';
import { VoiceDedupe } from '../src/features/voice-announcements/voice-dedupe';

describe('VoiceDedupe', () => {
  let dedupe: VoiceDedupe;

  beforeEach(() => {
    dedupe = new VoiceDedupe();
    dedupe.clear();
  });

  it('marks and detects duplicate by eventId', () => {
    expect(dedupe.has({ eventId: 'ep1:100' })).toBe(false);
    dedupe.mark({ eventId: 'ep1:100' });
    expect(dedupe.has({ eventId: 'ep1:100' })).toBe(true);
  });

  it('marks and detects duplicate by transactionId', () => {
    expect(dedupe.has({ transactionId: 'tx_123' })).toBe(false);
    dedupe.mark({ transactionId: 'tx_123' });
    expect(dedupe.has({ transactionId: 'tx_123' })).toBe(true);
    expect(dedupe.has({ eventId: 'ep1:different', transactionId: 'tx_123' })).toBe(true);
  });

  it('detects stale event older than max age', () => {
    const now = Date.now();
    const freshIso = new Date(now - 10_000).toISOString(); // 10s ago
    const staleIso = new Date(now - 200_000).toISOString(); // 200s ago

    expect(dedupe.isFreshEnough(freshIso, 120_000)).toBe(true);
    expect(dedupe.isFreshEnough(staleIso, 120_000)).toBe(false);
  });
});
