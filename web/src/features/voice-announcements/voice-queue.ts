import type { VoiceEngine, VoiceMessage } from './voice-engine';

export type VoiceQueueState = 'idle' | 'speaking';

export class VoiceQueue {
  private queue: VoiceMessage[] = [];
  private state: VoiceQueueState = 'idle';
  private engine: VoiceEngine;
  private onStateChange?: (state: VoiceQueueState) => void;

  constructor(engine: VoiceEngine, onStateChange?: (state: VoiceQueueState) => void) {
    this.engine = engine;
    this.onStateChange = onStateChange;
  }

  public getState(): VoiceQueueState {
    return this.state;
  }

  private setState(next: VoiceQueueState) {
    if (this.state !== next) {
      this.state = next;
      this.onStateChange?.(next);
    }
  }

  public enqueue(message: VoiceMessage): void {
    this.queue.push(message);
    if (this.state === 'idle') {
      void this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.setState('idle');
      return;
    }

    this.setState('speaking');
    const message = this.queue.shift()!;

    try {
      await this.engine.speak(message);
    } catch {
      // Swallowed safely
    }

    // Small delay between utterances for natural breathing room
    await new Promise((r) => setTimeout(r, 150));

    void this.processNext();
  }

  public cancel(): void {
    this.queue = [];
    this.engine.cancel();
    this.setState('idle');
  }

  public clear(): void {
    this.queue = [];
  }
}
