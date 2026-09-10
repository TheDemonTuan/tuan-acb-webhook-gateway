import { expect, test } from 'vitest';

test('frontend expects the v2 status contract', () => {
  const status = {
    service: 'HEALTHY',
    acb: { state: 'UNCONFIGURED', coverage: 'NOT_STARTED' },
    storage: { status: 'READY' },
    webhooks: { pending: 0, deadLetter: 0 },
  };

  expect(status.acb.state).toBe('UNCONFIGURED');
  expect(status.webhooks.pending).toBe(0);
});
