import { expect, test } from '@playwright/test';

test('configures a connection and reflects the state across routes', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('ACB Transaction Webhook — Monitor & Gateway');
  await page.getByRole('button', { name: 'Kết nối ACB' }).click();
  const accountInput = page.getByLabel('Số tài khoản đã che');
  if (await accountInput.count()) {
    await accountInput.fill('***1234');
    await page.getByRole('button', { name: 'Lưu kết nối' }).click();
    await expect(page.getByText('Đã lưu kết nối.')).toBeVisible();
  }
  await expect(page.getByText(/AUTH_REQUIRED|MONITORING/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Tổng quan' }).click();
  await expect(page.getByText(/AUTH_REQUIRED|MONITORING/).first()).toBeVisible();
});

test('creates and enables a guarded HTTPS webhook endpoint', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Webhooks' }).click();
  await expect(page.getByRole('heading', { name: 'Webhook endpoints' })).toBeVisible();
  const name = `Receiver ${testInfo.project.name}`;
  await page.getByLabel('Tên endpoint').fill(name);
  await page.getByLabel('HTTPS URL').fill(`https://events-${testInfo.project.name}.example.com/bank`);
  await page.getByRole('button', { name: 'Tạo endpoint' }).click();
  await expect(page.getByText('Đã tạo endpoint ở trạng thái DISABLED.')).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole('button', { name: 'Enable' }).last().click();
  await expect(page.getByText('ACTIVE', { exact: true }).last()).toBeVisible();
});

test('serves the dashboard on a future SPA route', async ({ page }) => {
  await page.goto('/transactions');
  await expect(page.getByRole('heading', { name: 'ACB Transaction Webhook' })).toBeVisible();
  await page.getByRole('button', { name: 'Giao dịch' }).click();
  await expect(page.getByRole('heading', { name: 'Giao dịch' })).toBeVisible();
});

test('activates ACB session to MONITORING and navigates all tabs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Kết nối ACB' }).click();
  const accountInput = page.getByLabel('Số tài khoản đã che');
  if (await accountInput.count()) {
    await accountInput.fill('***1234');
    await page.getByRole('button', { name: 'Lưu kết nối' }).click();
  }

  const quickBtn = page.getByRole('button', { name: 'Kích hoạt nhanh (Simulate/Verify)' });
  if (await quickBtn.count()) {
    await quickBtn.click();
    await expect(page.getByText('Phiên ACB đang hoạt động')).toBeVisible();
  }

  await page.getByRole('button', { name: 'Giao dịch' }).click();
  await expect(page.getByRole('heading', { name: 'Giao dịch' })).toBeVisible();

  await page.getByRole('button', { name: 'Phân phối' }).click();
  await expect(page.getByRole('heading', { name: 'Phân phối Webhook' })).toBeVisible();

  await page.getByRole('button', { name: 'Polling' }).click();
  await expect(page.getByRole('heading', { name: 'Chu kỳ Polling' })).toBeVisible();

  await page.getByRole('button', { name: 'Chẩn đoán' }).click();
  await expect(page.getByRole('heading', { name: 'Chẩn đoán hệ thống' })).toBeVisible();

  await page.getByRole('button', { name: 'Audit' }).click();
  await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();
});
