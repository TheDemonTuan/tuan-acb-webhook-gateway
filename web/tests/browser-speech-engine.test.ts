import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSpeechEngine, isVietnameseVoice } from '../src/features/voice-announcements/browser-speech-engine';

describe('BrowserSpeechEngine strict Vietnamese', () => {
  let prevWindow: any;

  beforeEach(() => {
    prevWindow = (globalThis as any).window;
  });

  afterEach(() => {
    (globalThis as any).window = prevWindow;
  });

  it('correctly identifies Vietnamese language tags', () => {
    expect(isVietnameseVoice({ lang: 'vi-VN' })).toBe(true);
    expect(isVietnameseVoice({ lang: 'vi' })).toBe(true);
    expect(isVietnameseVoice({ lang: 'vi_VN' })).toBe(true);
    expect(isVietnameseVoice({ lang: 'vi-vn' })).toBe(true);
    expect(isVietnameseVoice({ lang: 'en-US' })).toBe(false);
    expect(isVietnameseVoice({ lang: 'fr-FR' })).toBe(false);
    expect(isVietnameseVoice({ lang: '' })).toBe(false);
    expect(isVietnameseVoice({})).toBe(false);
  });

  it('throws BROWSER_VIETNAMESE_VOICE_UNAVAILABLE when only English voice exists', async () => {
    class MockUtterance {
      text: string;
      lang = 'en-US';
      voice: any = null;
      constructor(text: string) {
        this.text = text;
      }
    }

    const mockSynth = {
      paused: false,
      speaking: false,
      getVoices: () => [
        {
          default: true,
          lang: 'en-US',
          name: 'Microsoft David - English (United States)',
          voiceURI: 'en-us-david',
        },
      ],
      speak: vi.fn(),
      cancel: vi.fn(),
      resume: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    (globalThis as any).window = {
      speechSynthesis: mockSynth,
      SpeechSynthesisUtterance: MockUtterance,
    };

    const engine = new BrowserSpeechEngine();
    await expect(
      engine.speak({ text: 'Bạn vừa nhận được tiền' })
    ).rejects.toThrow('BROWSER_VIETNAMESE_VOICE_UNAVAILABLE');

    expect(mockSynth.speak).not.toHaveBeenCalled();
  });

  it('speaks successfully when Vietnamese voice is available', async () => {
    class MockUtterance {
      text: string;
      lang = 'vi-VN';
      voice: any = null;
      volume = 1;
      rate = 1;
      pitch = 1;
      onend: any = null;
      onerror: any = null;
      constructor(text: string) {
        this.text = text;
      }
    }

    const mockSynth = {
      paused: false,
      speaking: false,
      getVoices: () => [
        {
          default: true,
          lang: 'vi-VN',
          name: 'Microsoft Hoai My - Vietnamese (Vietnam)',
          voiceURI: 'vi-vn-hoaimy',
        },
        {
          default: false,
          lang: 'en-US',
          name: 'Microsoft David - English (United States)',
          voiceURI: 'en-us-david',
        },
      ],
      speak: vi.fn((utt: any) => {
        setTimeout(() => {
          utt.onend?.(new Event('end'));
        }, 10);
      }),
      cancel: vi.fn(),
      resume: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    (globalThis as any).window = {
      speechSynthesis: mockSynth,
      SpeechSynthesisUtterance: MockUtterance,
    };

    const engine = new BrowserSpeechEngine();
    await expect(
      engine.speak({ text: 'Bạn vừa nhận được tiền' })
    ).resolves.toBeUndefined();

    expect(mockSynth.speak).toHaveBeenCalledTimes(1);
  });
});
