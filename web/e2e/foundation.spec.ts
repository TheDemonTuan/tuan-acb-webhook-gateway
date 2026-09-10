import { expect, test } from '@playwright/test';

test('configures a connection and reflects the state across routes', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('TuanBankGateway — ACB Web Monitor');
  await page.getByRole('button', { name: 'Kết nối ACB' }).click();
  const accountInput = page.getByLabel('Số tài khoản đã che');
  if (await accountInput.count()) {
    await accountInput.fill('***1234');
    await page.getByRole('button', { name: 'Lưu kết nối' }).click();
    await expect(page.getByText('Đã lưu kết nối.')).toBeVisible();
  }
  await expect(page.getByText('AUTH_REQUIRED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tổng quan' }).click();
  await expect(page.getByText('AUTH_REQUIRED', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'TuanBankGateway' })).toBeVisible();
  await page.getByRole('button', { name: 'Giao dịch' }).click();
  await expect(page.getByRole('heading', { name: 'Giao dịch' })).toBeVisible();
});
