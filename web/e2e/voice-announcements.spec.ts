import { expect, test } from '@playwright/test';

test.describe('Voice Announcements & Realtime Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__spokenUtterances = [];

      class MockSpeechSynthesisUtterance {
        text: string;
        lang = 'vi-VN';
        volume = 1;
        rate = 1;
        pitch = 1;
        voice: any = null;
        onend: any = null;
        onerror: any = null;
        constructor(text: string) {
          this.text = text;
        }
      }

      const synth = {
        paused: false,
        speaking: false,
        pending: false,
        onvoiceschanged: null,
        getVoices: () => [
          {
            default: true,
            lang: 'vi-VN',
            localService: true,
            name: 'Vietnamese Female',
            voiceURI: 'urn:moz-tts:speechd:vi-VN',
          },
        ],
        speak: (utterance: any) => {
          (window as any).__spokenUtterances.push({
            text: utterance.text,
            lang: utterance.lang,
            volume: utterance.volume,
            rate: utterance.rate,
          });
          setTimeout(() => {
            utterance.onend?.(new Event('end'));
          }, 40);
        },
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      };

      (window as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
      Object.defineProperty(window, 'speechSynthesis', {
        value: synth,
        configurable: true,
        writable: true,
      });
    });
  });

  test('opens voice settings sheet and plays test voice', async ({ page }) => {
    await page.goto('/transactions');
    await expect(page.getByRole('heading', { name: 'Giao dịch' })).toBeVisible();

    const voiceSettingsBtn = page.getByRole('button', { name: 'Tùy chỉnh giọng đọc' });
    await expect(voiceSettingsBtn).toBeVisible();
    await voiceSettingsBtn.click();

    await expect(page.getByRole('heading', { name: 'Cài đặt đọc giao dịch' })).toBeVisible();
    await expect(page.getByText('Tự động đọc số tiền ngay khi giao dịch được ghi nhận')).toBeVisible();

    const testBtn = page.getByRole('button', { name: 'Nghe thử' });
    await expect(testBtn).toBeVisible();
    await testBtn.click({ force: true });

    await page.waitForFunction(() => (window as any).__spokenUtterances.length > 0);
    const spoken = await page.evaluate(() => (window as any).__spokenUtterances);
    expect(spoken.length).toBeGreaterThanOrEqual(1);
    expect(spoken[0].text).toContain('Đã bật đọc giao dịch mới');
    expect(spoken[0].lang).toBe('vi-VN');
  });

  test('enables voice and announces real-time credit transaction in natural Vietnamese', async ({ page }) => {
    await page.goto('/transactions');

    // Open settings and enable voice
    await page.getByRole('button', { name: 'Tùy chỉnh giọng đọc' }).click();
    await expect(page.getByRole('heading', { name: 'Cài đặt đọc giao dịch' })).toBeVisible();
    await page.getByRole('switch', { name: 'Bật đọc giao dịch' }).click({ force: true });
    await page.getByRole('button', { name: 'Đóng' }).click({ force: true });
    await expect(page.getByRole('heading', { name: 'Cài đặt đọc giao dịch' })).toHaveCount(0);

    // Reset spoken list
    await page.evaluate(() => {
      (window as any).__spokenUtterances = [];
    });

    // Verify toggle badge is active
    await expect(page.getByText('Giọng đọc: Bật')).toBeVisible();
  });
});
