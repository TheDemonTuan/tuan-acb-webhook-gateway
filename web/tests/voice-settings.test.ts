import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadVoiceSettings,
  saveVoiceSettings,
} from '../src/features/voice-announcements/voice-settings';

describe('voice-settings', () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    };
  });

  it('loads default settings when empty', () => {
    const settings = loadVoiceSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.volume).toBe(1);
    expect(settings.rate).toBe(1);
    expect(settings.includeDescription).toBe(false);
  });

  it('saves and reloads modified settings', () => {
    saveVoiceSettings({ enabled: true, volume: 0.8, includeDescription: true });
    const loaded = loadVoiceSettings();
    expect(loaded.enabled).toBe(true);
    expect(loaded.volume).toBe(0.8);
    expect(loaded.includeDescription).toBe(true);
  });

  it('clamps invalid values', () => {
    saveVoiceSettings({ volume: 5, rate: 0.1 });
    const loaded = loadVoiceSettings();
    expect(loaded.volume).toBe(1); // clamped max 1
    expect(loaded.rate).toBe(0.5); // clamped min 0.5
  });
});
