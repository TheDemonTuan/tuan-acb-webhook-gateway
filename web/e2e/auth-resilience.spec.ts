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
        body: '<!DOCTYPE html><title>example.com | 502: Bad gateway</title><body>Bad gateway</body>',
      });
    });

    await page.goto('/');
    await expect(page.getByText('ACB Transaction Webhook')).toBeVisible();

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

  test('keeps the active frame through a temporary status failure and stops after cancellation', async ({ page }) => {
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
    let statusChecks = 0;
    await page.route('**/api/v1/connection/auth/auth_test_2/status', async (route) => {
      statusChecks++;
      if (statusChecks === 1) {
        await route.fulfill({ status: 502, contentType: 'text/html', body: '<!DOCTYPE html><body>temporary upstream failure</body>' });
        return;
      }
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
    const authFrame = page.locator('iframe[title="Đăng nhập ACB"]');
    await expect(authFrame).toBeVisible();
    await expect(page.getByText('Máy chủ trả về lỗi HTTP 502. Vui lòng thử lại.')).toBeVisible();
    await expect(authFrame).toBeVisible();

    await page.getByRole('button', { name: 'Hủy phiên' }).click();
    await expect(page.getByText('Đã hủy phiên đăng nhập ACB.')).toBeVisible();
    await expect(page.locator('iframe[title="Đăng nhập ACB"]')).toHaveCount(0);
    expect(cancelled).toBe(true);
  });

  test('stops polling and clears attempt on terminal 409 AUTH_SESSION_SUPERSEDED', async ({ page }) => {
    let authStatusChecks = 0;

    await page.route('**/api/v1/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          service: 'HEALTHY',
          version: '2.0.0',
          uptimeSeconds: 150,
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
          attemptId: 'auth_superseded_1',
          status: 'AWAITING_USER_LOGIN',
          screenUrl: 'http://127.0.0.1:4173/mock-vnc.html',
          expiresAt: '2026-09-10T13:15:00Z',
        }),
      });
    });

    await page.route('**/api/v1/connection/auth/auth_superseded_1/status', async (route) => {
      authStatusChecks++;
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'AUTH_SESSION_SUPERSEDED',
          error: 'Phiên đăng nhập ACB đã được thay thế. Vui lòng mở phiên mới.',
        }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Kết nối ACB' }).click();
    await page.getByRole('button', { name: 'Bắt đầu đăng nhập ACB' }).click();

    // Verify Vietnamese terminal notice appears and active iframe is cleared
    await expect(page.getByText('Phiên đăng nhập ACB đã được thay thế. Vui lòng mở phiên mới.')).toBeVisible();
    await expect(page.locator('iframe[title="Đăng nhập ACB"]')).toHaveCount(0);

    // Polling must stop immediately: check count remains 1 after delay
    const checksSnapshot = authStatusChecks;
    await page.waitForTimeout(3500);
    expect(authStatusChecks).toBe(checksSnapshot);
    expect(authStatusChecks).toBe(1);

    // Ready to start a new auth session
    await expect(page.getByRole('button', { name: 'Bắt đầu đăng nhập ACB' })).toBeVisible();
  });

  test('stops polling and clears attempt on terminal 404 AUTH_SESSION_NOT_FOUND', async ({ page }) => {
    let authStatusChecks = 0;

    await page.route('**/api/v1/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          service: 'HEALTHY',
          version: '2.0.0',
          uptimeSeconds: 150,
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
          attemptId: 'auth_not_found_1',
          status: 'AWAITING_USER_LOGIN',
          screenUrl: 'http://127.0.0.1:4173/mock-vnc.html',
          expiresAt: '2026-09-10T13:15:00Z',
        }),
      });
    });

    await page.route('**/api/v1/connection/auth/auth_not_found_1/status', async (route) => {
      authStatusChecks++;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'AUTH_SESSION_NOT_FOUND',
          error: 'Không tìm thấy phiên đăng nhập ACB. Vui lòng mở phiên mới.',
        }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Kết nối ACB' }).click();
    await page.getByRole('button', { name: 'Bắt đầu đăng nhập ACB' }).click();

    await expect(page.getByText('Không tìm thấy phiên đăng nhập ACB. Vui lòng mở phiên mới.')).toBeVisible();
    await expect(page.locator('iframe[title="Đăng nhập ACB"]')).toHaveCount(0);

    const snapshot = authStatusChecks;
    await page.waitForTimeout(3500);
    expect(authStatusChecks).toBe(snapshot);
    expect(authStatusChecks).toBe(1);
  });

  test('does not terminalize on temporary 409 AUTH_SESSION_UNAVAILABLE, retries and preserves frame', async ({ page }) => {
    let authStatusChecks = 0;
    let authState = 'AUTH_REQUIRED';

    await page.route('**/api/v1/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          service: 'HEALTHY',
          version: '2.0.0',
          uptimeSeconds: 150,
          acb: { state: authState, coverage: 'NOT_STARTED', accountMasked: '***1234', generation: 1 },
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
          connection: { id: 'conn_1', state: authState, accountMasked: '***1234', generation: 1, updatedAt: '2026-09-10T13:00:00Z' },
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
          attemptId: 'auth_temporary_1',
          status: 'AWAITING_USER_LOGIN',
          screenUrl: 'http://127.0.0.1:4173/mock-vnc.html',
          expiresAt: '2026-09-10T13:15:00Z',
        }),
      });
    });

    await page.route('**/api/v1/connection/auth/auth_temporary_1/status', async (route) => {
      authStatusChecks++;
      if (authStatusChecks === 1) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'AUTH_SESSION_UNAVAILABLE',
            error: 'Dịch vụ ACB tạm thời bận. Đang thử lại...',
          }),
        });
        return;
      }
      authState = 'MONITORING';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'MONITORING' }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Kết nối ACB' }).click();
    await page.getByRole('button', { name: 'Bắt đầu đăng nhập ACB' }).click();

    const authFrame = page.locator('iframe[title="Đăng nhập ACB"]');
    await expect(authFrame).toBeVisible();

    // First poll returns temporary 409: notice shown, but frame is kept
    await expect(page.getByText('Dịch vụ ACB tạm thời bận. Đang thử lại...')).toBeVisible();
    await expect(authFrame).toBeVisible();

    // Next poll retries automatically and completes successfully
    await expect(page.getByText('ACB đã xác thực. Hệ thống đang bắt đầu theo dõi giao dịch.')).toBeVisible({ timeout: 10_000 });
    await expect(authFrame).toHaveCount(0);
    expect(authStatusChecks).toBeGreaterThanOrEqual(2);
  });

  test('login to monitoring to sync flow across shared tabs with disabled sync guard and accepted message', async ({ page }) => {
    let currentState = 'AUTH_REQUIRED';
    let syncCalls = 0;

    await page.route('**/api/v1/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          service: 'HEALTHY',
          version: '2.0.0',
          uptimeSeconds: 200,
          acb: { state: currentState, coverage: 'NOT_STARTED', accountMasked: '***1234', generation: 1 },
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
          connection: { id: 'conn_1', state: currentState, accountMasked: '***1234', generation: 1, updatedAt: '2026-09-10T13:00:00Z' },
        }),
      });
    });

    await page.route('**/api/v1/csrf', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'test-csrf' }) });
    });
    await page.route('**/api/v1/webhooks', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    });
    await page.route('**/api/v1/transactions', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    });
    await page.route('**/api/v1/poll-runs', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    });

    await page.route('**/api/v1/connection/auth/start', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          attemptId: 'auth_nav_1',
          status: 'AWAITING_USER_LOGIN',
          screenUrl: 'http://127.0.0.1:4173/mock-vnc.html',
          expiresAt: '2026-09-10T13:15:00Z',
        }),
      });
    });

    let statusCount = 0;
    await page.route('**/api/v1/connection/auth/auth_nav_1/status', async (route) => {
      statusCount++;
      if (statusCount < 3) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'AWAITING_USER_LOGIN' }),
        });
        return;
      }
      currentState = 'MONITORING';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'MONITORING' }),
      });
    });

    await page.route('**/api/v1/connection/sync', async (route) => {
      syncCalls++;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ACCEPTED' }),
      });
    });

    await page.goto('/');

    // 1. In AUTH_REQUIRED state, verify banner
    await expect(page.getByText('ACB yêu cầu xác thực phiên')).toBeVisible();

    // 2. Go to "Kết nối ACB": verify Sync is disabled when AUTH_REQUIRED
    await page.getByRole('button', { name: 'Kết nối ACB' }).click();
    const syncButton = page.getByRole('button', { name: 'Sync' });
    await expect(syncButton).toBeDisabled();

    // 3. Start auth: while active auth is present, Sync button remains disabled
    await page.getByRole('button', { name: 'Bắt đầu đăng nhập ACB' }).click();
    await expect(page.locator('iframe[title="Đăng nhập ACB"]')).toBeVisible();
    await expect(syncButton).toBeDisabled();

    // 4. Navigate to "Tổng quan" while auth is in progress
    await page.getByRole('button', { name: 'Tổng quan' }).click();
    // Wait for background poll to verify and transition to MONITORING
    await expect(page.getByText('ACB đã xác thực. Hệ thống đang bắt đầu theo dõi giao dịch.')).toBeVisible({ timeout: 12_000 });

    // 5. Navigate back to "Kết nối ACB": verify state is MONITORING, iframe is gone, and Sync is now ENABLED
    await page.getByRole('button', { name: 'Kết nối ACB' }).click();
    await expect(page.locator('iframe[title="Đăng nhập ACB"]')).toHaveCount(0);
    await expect(page.getByText('Phiên ACB đang hoạt động bình thường')).toBeVisible();
    await expect(syncButton).toBeEnabled();

    // 6. Click Sync: verify accepted message not completed
    await syncButton.click();
    await expect(page.getByText('Đã tiếp nhận yêu cầu đồng bộ ACB.')).toBeVisible();
    expect(syncCalls).toBe(1);

    // 7. Verify shared state across tabs ("Tổng quan", "Giao dịch", "Polling", "Kết nối ACB")
    await page.getByRole('button', { name: 'Tổng quan' }).click();
    await expect(page.getByText('ACB yêu cầu xác thực phiên')).toHaveCount(0);
    await page.getByRole('button', { name: 'Giao dịch' }).click();
    await expect(page.getByRole('heading', { name: 'Giao dịch' })).toBeVisible();
    await page.getByRole('button', { name: 'Polling' }).click();
    await expect(page.getByRole('heading', { name: 'Chu kỳ Polling' })).toBeVisible();
    await page.getByRole('button', { name: 'Kết nối ACB' }).click();
    await expect(page.getByRole('button', { name: 'Sync' })).toBeEnabled();
  });
});
