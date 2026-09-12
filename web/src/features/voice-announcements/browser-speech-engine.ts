import type { VoiceEngine, VoiceInfo, VoiceMessage } from './voice-engine';

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

    // In some browsers, speechSynthesis can get into a paused state
    if (synth.paused) {
      synth.resume();
    }

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(message.text);
      utterance.lang = message.lang || 'vi-VN';
      utterance.volume = message.volume ?? 1;
      utterance.rate = message.rate ?? 1;
      utterance.pitch = message.pitch ?? 1;

      const rawVoices = synth.getVoices();
      let selectedVoice: SpeechSynthesisVoice | undefined;

      if (message.voiceURI) {
        selectedVoice = rawVoices.find((v) => v.voiceURI === message.voiceURI);
      }

      if (!selectedVoice) {
        // Priority: exact vi-VN -> starts with vi -> contains vietnam / tiếng việt -> default voice
        selectedVoice =
          rawVoices.find((v) => v.lang.toLowerCase() === 'vi-vn') ??
          rawVoices.find((v) => v.lang.toLowerCase().startsWith('vi')) ??
          rawVoices.find(
            (v) =>
              v.name.toLowerCase().includes('vietnamese') ||
              v.name.toLowerCase().includes('tiếng việt') ||
              v.name.toLowerCase().includes('viet nam')
          ) ??
          rawVoices.find((v) => v.default) ??
          rawVoices[0];
      }

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };

      utterance.onend = finish;
      utterance.onerror = () => {
        finish();
      };

      // Fallback timeout in case utterance stalls
      const maxSpeechTimeout = Math.max(3000, message.text.length * 150);
      setTimeout(finish, maxSpeechTimeout);

      synth.speak(utterance);
    });
  }

  public cancel(): void {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}
