import { expect, test } from 'vitest';
import { apiErrorMessage } from '../src/api';

test('does not expose an HTML upstream error page', async () => {
  const html = '<!DOCTYPE html><title>502: Bad gateway</title>';
  const response = new Response(html, { status: 502, headers: { 'Content-Type': 'text/html' } });
  const message = await apiErrorMessage(response);
  expect(message).toBe('Máy chủ trả về lỗi HTTP 502. Vui lòng thử lại.');
  expect(message).not.toContain('DOCTYPE');
});

test('uses a JSON API error message', async () => {
  const response = new Response(JSON.stringify({ error: 'Phiên đăng nhập đã hết hạn.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  });
  await expect(apiErrorMessage(response)).resolves.toBe('Phiên đăng nhập đã hết hạn.');
});

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
