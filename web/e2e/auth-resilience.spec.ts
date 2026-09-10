import { expect, test } from '@playwright/test';

test.describe('ACB Auth & Error Resilience', () => {
  test('renders concise message instead of Cloudflare 502 HTML and stops polling on failure', async ({ page }) => {
    let authStatusChecks = 0;
    await page.route('**/api/v1/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          service: 'HEALTHY',
          version: '2.0.0',
          uptimeSeconds: 120,
          acb: { state: 'AUTH_REQUIRED', coverage: 'NOT_STARTED', accountMasked: '***1234', generation: 1 },
          storage: { status: 'READY' },
          webhooks: { pending: 0, deadLetter: 0 },
        }),
      });
    });

    await page.route('**/api/v1/connection', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          connection: { id: 'conn_1', state: 'AUTH_REQUIRED', accountMasked: '***1234', generation: 1, updatedAt: '2026-09-10T13:00:00Z' },
        }),
      });
    });

    await page.route('**/api/v1/csrf', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'test-csrf' }) });
    });
    await page.route('**/api/v1/webhooks', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    });

    await page.route('**/api/v1/connection/auth/start', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          attemptId: 'auth_test_1',
          status: 'AWAITING_USER_LOGIN',
          screenUrl: 'http://127.0.0.1:4173/mock-vnc.html',
          expiresAt: '2026-09-10T13:15:00Z',
        }),
      });
    });

    await page.route('**/api/v1/connection/auth/auth_test_1/status', async (route) => {
      authStatusChecks++;
      if (authStatusChecks === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'AWAITING_USER_LOGIN' }),
        });
        return;
      }
      await route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<!DOCTYPE html><title>tuannguyenviet.site | 502: Bad gateway</title><body>Bad gateway</body>',
      });
    });

    await page.goto('/');
    await expect(page.getByText('TuanBankGateway')).toBeVisible();

    await page.getByRole('button', { name: 'Kết nối ACB' }).click();
    await expect(page.getByRole('heading', { name: /Đăng nhập & Xác thực ACB/ })).toBeVisible();

    const startButton = page.getByRole('button', { name: 'Bắt đầu đăng nhập ACB' });
    await expect(startButton).toBeVisible();
    await startButton.click();

    await expect(page.getByText('Trình duyệt ACB đã sẵn sàng.')).toBeVisible();
    await expect(page.locator('iframe[title="Đăng nhập ACB"]')).toBeVisible();

    await expect(page.getByText('Máy chủ trả về lỗi HTTP 502. Vui lòng thử lại.')).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('DOCTYPE');
    expect(bodyText).not.toContain('Cloudflare Ray ID');
  });

  test('cancels active session and resets frame cleanly', async ({ page }) => {
    let cancelled = false;
    await page.route('**/api/v1/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          service: 'HEALTHY',
          version: '2.0.0',
          uptimeSeconds: 120,
          acb: { state: 'AUTH_REQUIRED', coverage: 'NOT_STARTED', accountMasked: '***1234', generation: 1 },
          storage: { status: 'READY' },
          webhooks: { pending: 0, deadLetter: 0 },
        }),
      });
    });
    await page.route('**/api/v1/connection', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          connection: { id: 'conn_1', state: 'AUTH_REQUIRED', accountMasked: '***1234', generation: 1, updatedAt: '2026-09-10T13:00:00Z' },
        }),
      });
    });
    await page.route('**/api/v1/csrf', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'test-csrf' }) });
    });
    await page.route('**/api/v1/webhooks', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    });
    await page.route('**/api/v1/connection/auth/start', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          attemptId: 'auth_test_2',
          status: 'AWAITING_USER_LOGIN',
          screenUrl: 'http://127.0.0.1:4173/mock-vnc.html',
          expiresAt: '2026-09-10T13:15:00Z',
        }),
      });
    });
    await page.route('**/api/v1/connection/auth/auth_test_2/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'AWAITING_USER_LOGIN' }),
      });
    });
    await page.route('**/api/v1/connection/auth/cancel', async (route) => {
      cancelled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'CANCELLED' }) });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Kết nối ACB' }).click();
    await page.getByRole('button', { name: 'Bắt đầu đăng nhập ACB' }).click();
    await expect(page.locator('iframe[title="Đăng nhập ACB"]')).toBeVisible();

    await page.getByRole('button', { name: 'Hủy phiên' }).click();
    await expect(page.getByText('Đã hủy phiên đăng nhập ACB.')).toBeVisible();
    await expect(page.locator('iframe[title="Đăng nhập ACB"]')).toHaveCount(0);
    expect(cancelled).toBe(true);
  });
});
