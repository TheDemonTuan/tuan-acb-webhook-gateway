import type { VoiceEngine, VoiceInfo, VoiceMessage } from './voice-engine';

export function isVietnameseVoice(v: { lang?: string }): boolean {
  if (!v.lang) return false;
  const lang = v.lang.toLowerCase().replace('_', '-');
  return lang === 'vi' || lang.startsWith('vi-');
}

export class BrowserSpeechEngine implements VoiceEngine {
  public isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    );
  }

  public async getVoices(): Promise<VoiceInfo[]> {
    if (!this.isSupported()) return [];

    const synth = window.speechSynthesis;
    let rawVoices = synth.getVoices();

    if (rawVoices.length > 0) {
      return this.mapVoices(rawVoices);
    }

    return new Promise((resolve) => {
      let resolved = false;
      const onVoicesChanged = () => {
        if (resolved) return;
        resolved = true;
        synth.removeEventListener('voiceschanged', onVoicesChanged);
        resolve(this.mapVoices(synth.getVoices()));
      };

      synth.addEventListener('voiceschanged', onVoicesChanged);

      // Fallback timeout in case voiceschanged never fires
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          synth.removeEventListener('voiceschanged', onVoicesChanged);
          resolve(this.mapVoices(synth.getVoices()));
        }
      }, 500);
    });
  }

  private mapVoices(voices: SpeechSynthesisVoice[]): VoiceInfo[] {
    return voices.map((v) => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang,
      isDefault: v.default,
    }));
  }

  public async speak(message: VoiceMessage): Promise<void> {
    if (!this.isSupported() || !message.text) return;

    const synth = window.speechSynthesis;

    if (synth.paused) {
      synth.resume();
    }

    const rawVoices = synth.getVoices();
    let selectedVoice: SpeechSynthesisVoice | undefined;

    if (message.voiceURI) {
      const match = rawVoices.find((v) => v.voiceURI === message.voiceURI);
      if (match && isVietnameseVoice(match)) {
        selectedVoice = match;
      }
    }

    if (!selectedVoice) {
      selectedVoice =
        rawVoices.find((v) => v.lang.toLowerCase().replace('_', '-') === 'vi-vn') ??
        rawVoices.find((v) => isVietnameseVoice(v));
    }

    // STRICT VIETNAMESE ONLY: Never fallback to English or default non-Vietnamese voices!
    if (!selectedVoice) {
      throw new Error('BROWSER_VIETNAMESE_VOICE_UNAVAILABLE');
    }

    return new Promise((resolve, reject) => {
      const UtteranceClass = (window as any).SpeechSynthesisUtterance || SpeechSynthesisUtterance;
      const utterance = new UtteranceClass(message.text);
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang || 'vi-VN';
      utterance.volume = message.volume ?? 1;
      utterance.rate = message.rate ?? 1;
      utterance.pitch = message.pitch ?? 1;

      let settled = false;

      utterance.onend = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        if (!settled) {
          settled = true;
          if (event.error === 'canceled' || event.error === 'interrupted') {
            resolve();
          } else {
            reject(new Error(`BROWSER_SPEECH_ERROR: ${event.error || 'unknown'}`));
          }
        }
      };

      synth.speak(utterance);
    });
  }

  public cancel(): void {
    if (this.isSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
  }
}
