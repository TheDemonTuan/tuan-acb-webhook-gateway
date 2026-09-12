import { describe, expect, it } from 'vitest';
import type { VoiceEngine, VoiceInfo, VoiceMessage } from '../src/features/voice-announcements/voice-engine';
import { VoiceQueue } from '../src/features/voice-announcements/voice-queue';

class FakeVoiceEngine implements VoiceEngine {
  public spoken: string[] = [];
  public cancelled = false;

  isSupported(): boolean {
    return true;
  }
  async getVoices(): Promise<VoiceInfo[]> {
    return [];
  }
  async speak(message: VoiceMessage): Promise<void> {
    this.spoken.push(message.text);
  }
  cancel(): void {
    this.cancelled = true;
  }
}

describe('VoiceQueue', () => {
  it('processes messages sequentially', async () => {
    const fake = new FakeVoiceEngine();
    const queue = new VoiceQueue(fake);

    queue.enqueue({ text: 'Câu thứ nhất' });
    queue.enqueue({ text: 'Câu thứ hai' });

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 400));

    expect(fake.spoken).toEqual(['Câu thứ nhất', 'Câu thứ hai']);
    expect(queue.getState()).toBe('idle');
  });

  it('cancels queue and engine', () => {
    const fake = new FakeVoiceEngine();
    const queue = new VoiceQueue(fake);

    queue.enqueue({ text: 'Câu 1' });
    queue.cancel();

    expect(fake.cancelled).toBe(true);
    expect(queue.getState()).toBe('idle');
  });
});
