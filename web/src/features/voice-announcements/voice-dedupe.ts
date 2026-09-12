const STORAGE_KEY = 'acb.voice.processed-events.v1';
const MAX_ENTRIES = 500;
export const DEFAULT_MAX_REPLAY_AGE_MS = 120_000; // 120 seconds

export interface DedupeKeyOptions {
  eventId?: string | null;
  transactionId?: string | null;
  semanticKey?: string | null;
}

export class VoiceDedupe {
  private processedKeys = new Set<string>();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach((k) => {
            if (typeof k === 'string') this.processedKeys.add(k);
          });
        }
      }
    } catch {
      // Session storage access error fallback to memory
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const arr = Array.from(this.processedKeys);
      const trimmed = arr.slice(-MAX_ENTRIES);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Ignore quota/access errors
    }
  }

  public getKeys(opts: DedupeKeyOptions): string[] {
    const keys: string[] = [];
    if (opts.eventId) keys.push(`ev:${opts.eventId}`);
    if (opts.transactionId) keys.push(`tx:${opts.transactionId}`);
    if (opts.semanticKey) keys.push(`sem:${opts.semanticKey}`);
    return keys;
  }

  public has(opts: DedupeKeyOptions): boolean {
    const keys = this.getKeys(opts);
    if (keys.length === 0) return false;
    return keys.some((k) => this.processedKeys.has(k));
  }

  public mark(opts: DedupeKeyOptions): void {
    const keys = this.getKeys(opts);
    if (keys.length === 0) return;

    keys.forEach((k) => this.processedKeys.add(k));

    if (this.processedKeys.size > MAX_ENTRIES * 1.5) {
      const arr = Array.from(this.processedKeys).slice(-MAX_ENTRIES);
      this.processedKeys = new Set(arr);
    }

    this.saveToStorage();
  }

  public clear(): void {
    this.processedKeys.clear();
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
  }

  /**
   * Checks if an event is fresh enough to speak (not an old replay > 120s).
   */
  public isFreshEnough(detectedAt?: string, maxAgeMs = DEFAULT_MAX_REPLAY_AGE_MS): boolean {
    if (!detectedAt) return true;
    try {
      const time = new Date(detectedAt).getTime();
      if (Number.isNaN(time)) return true;
      const age = Date.now() - time;
      return age >= 0 && age <= maxAgeMs;
    } catch {
      return true;
    }
  }
}

export const defaultVoiceDedupe = new VoiceDedupe();
