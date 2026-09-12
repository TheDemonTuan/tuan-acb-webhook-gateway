export interface VoiceInfo {
  uri: string;
  name: string;
  lang: string;
  isDefault: boolean;
}

export interface VoiceMessage {
  text: string;
  volume?: number;
  rate?: number;
  pitch?: number;
  voiceURI?: string;
  lang?: string;
  transactionId?: string;
  summaryTransactionIds?: string[];
  isTest?: boolean;
  isReplay?: boolean;
  includeDescription?: boolean;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export interface VoiceEngine {
  isSupported(): boolean;
  getVoices(): Promise<VoiceInfo[]>;
  speak(message: VoiceMessage): Promise<void>;
  cancel(): void;
}

