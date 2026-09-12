import { expect, test } from 'vitest';
import {
  ApiError,
  AUTH_CODE_NOT_FOUND,
  AUTH_CODE_SUPERSEDED,
  AUTH_CODE_UNAVAILABLE,
  CSRF_CODE_ORIGIN_MISMATCH,
  CSRF_CODE_TOKEN_INVALID,
  apiErrorMessage,
  isTerminalAuthError,
  parseApiError,
} from '../src/api';

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

test('parses ApiError with HTTP status and stable code for AUTH_SESSION_SUPERSEDED', async () => {
  const response = new Response(
    JSON.stringify({
      code: AUTH_CODE_SUPERSEDED,
      error: 'Phiên đăng nhập ACB đã được thay thế. Vui lòng mở phiên mới.',
    }),
    {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const error = await parseApiError(response);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.status).toBe(409);
  expect(error.code).toBe('AUTH_SESSION_SUPERSEDED');
  expect(error.message).toBe('Phiên đăng nhập ACB đã được thay thế. Vui lòng mở phiên mới.');
  expect(isTerminalAuthError(error)).toBe(true);
});

test('parses ApiError with HTTP status and stable code for AUTH_SESSION_NOT_FOUND', async () => {
  const response = new Response(
    JSON.stringify({
      code: AUTH_CODE_NOT_FOUND,
      error: 'Không tìm thấy phiên đăng nhập ACB. Vui lòng mở phiên mới.',
    }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const error = await parseApiError(response);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.status).toBe(404);
  expect(error.code).toBe('AUTH_SESSION_NOT_FOUND');
  expect(error.message).toBe('Không tìm thấy phiên đăng nhập ACB. Vui lòng mở phiên mới.');
  expect(isTerminalAuthError(error)).toBe(true);
});

test('does not treat AUTH_SESSION_UNAVAILABLE or generic 409 as terminal', async () => {
  const unavailableResponse = new Response(
    JSON.stringify({
      code: AUTH_CODE_UNAVAILABLE,
      error: 'Dịch vụ ACB tạm thời không sẵn sàng. Vui lòng thử lại sau.',
    }),
    {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const unavailableError = await parseApiError(unavailableResponse);
  expect(unavailableError.status).toBe(409);
  expect(unavailableError.code).toBe('AUTH_SESSION_UNAVAILABLE');
  expect(isTerminalAuthError(unavailableError)).toBe(false);

  const generic409 = new ApiError('Conflict', 409);
  expect(isTerminalAuthError(generic409)).toBe(false);

  const generic404 = new ApiError('Not found', 404);
  expect(isTerminalAuthError(generic404)).toBe(false);

  const nonApiError = new Error('Random error');
  expect(isTerminalAuthError(nonApiError)).toBe(false);
});

test('parses ApiError for ORIGIN_MISMATCH and CSRF_TOKEN_INVALID with clear messages', async () => {
  const originResponse = new Response(
    JSON.stringify({
      code: CSRF_CODE_ORIGIN_MISMATCH,
      error: 'csrf validation failed: origin mismatch',
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
  const originError = await parseApiError(originResponse);
  expect(originError.status).toBe(403);
  expect(originError.code).toBe('ORIGIN_MISMATCH');
  expect(originError.message).toContain('PUBLIC_ORIGIN');

  const tokenResponse = new Response(
    JSON.stringify({
      code: CSRF_CODE_TOKEN_INVALID,
      error: 'csrf validation failed: invalid token',
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
  const tokenError = await parseApiError(tokenResponse);
  expect(tokenError.status).toBe(403);
  expect(tokenError.code).toBe('CSRF_TOKEN_INVALID');
  expect(tokenError.message).toContain('CSRF');
});
