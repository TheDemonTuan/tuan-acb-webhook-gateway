import { describe, expect, it } from 'vitest';
import { isKnownEventType } from '../src/realtime/realtime.events';

describe('realtime-events', () => {
  it('recognizes authoritative event types', () => {
    expect(isKnownEventType('bank.transaction.credit')).toBe(true);
    expect(isKnownEventType('poll.completed')).toBe(true);
    expect(isKnownEventType('connection.changed')).toBe(true);
    expect(isKnownEventType('delivery.changed')).toBe(true);
    expect(isKnownEventType('unknown.random')).toBe(false);
  });
});
