import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceDedupe } from '../src/features/voice-announcements/voice-dedupe';

describe('Voice Burst Cancellation Dedupe Release', () => {
  let dedupe: VoiceDedupe;

  beforeEach(() => {
    dedupe = new VoiceDedupe();
    dedupe.clear();
  });

  it('releases dedupe reservations when burst items are cancelled before playback', () => {
    const opts1 = { eventId: 'ev_1', transactionId: 'tx_1' };
    const opts2 = { eventId: 'ev_2', transactionId: 'tx_2' };

    // Simulate items entering burst buffer
    expect(dedupe.reserve(opts1)).toBe(true);
    expect(dedupe.reserve(opts2)).toBe(true);
    expect(dedupe.isReserved(opts1)).toBe(true);
    expect(dedupe.isReserved(opts2)).toBe(true);

    // Burst buffer simulates holding these items
    const burstBuffer = [
      { amount: 100000n, desc: 'Test 1', dedupeOpts: opts1 },
      { amount: 200000n, desc: 'Test 2', dedupeOpts: opts2 },
    ];

    // Simulate cancelVoice handler
    for (const item of burstBuffer) {
      dedupe.release(item.dedupeOpts);
    }
    burstBuffer.length = 0;

    // Both items must be released and free to be re-reserved
    expect(dedupe.isReserved(opts1)).toBe(false);
    expect(dedupe.isReserved(opts2)).toBe(false);
    expect(dedupe.has(opts1)).toBe(false);
    expect(dedupe.has(opts2)).toBe(false);

    // Can reserve again cleanly
    expect(dedupe.reserve(opts1)).toBe(true);
    expect(dedupe.reserve(opts2)).toBe(true);
  });
});
