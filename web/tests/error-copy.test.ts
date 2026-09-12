import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import { formatErrorMessage } from '../src/content/error-copy';

describe('error-copy', () => {
  it('translates known error codes to polite Vietnamese messages', () => {
    const supersededErr = new ApiError('Conflict', 409, 'AUTH_SESSION_SUPERSEDED');
    expect(formatErrorMessage(supersededErr)).toBe(
      'Phiên đăng nhập ACB đã được thay thế. Vui lòng mở phiên mới.'
    );

    const rateLimitErr = new ApiError('Too Many Requests', 429, 'ACB_RATE_LIMITED');
    expect(formatErrorMessage(rateLimitErr)).toBe(
      'ACB đang giới hạn tần suất truy cập. Hệ thống sẽ tự động thử lại sau ít phút.'
    );
  });

  it('filters out raw HTML pages or DOCTYPE leak', () => {
    const htmlErr = new Error('<!DOCTYPE html><title>Cloudflare 502</title>');
    expect(formatErrorMessage(htmlErr)).toBe('Không thể kết nối máy chủ hoặc phản hồi không hợp lệ. Vui lòng thử lại.');
  });
});
