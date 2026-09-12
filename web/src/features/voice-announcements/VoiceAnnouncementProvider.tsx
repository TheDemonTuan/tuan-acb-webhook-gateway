import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserSpeechEngine } from './browser-speech-engine';
import { MultiTabLeader } from './multi-tab-leader';
import { VoiceDedupe } from './voice-dedupe';
import type { VoiceEngine, VoiceInfo } from './voice-engine';
import { VoiceQueue } from './voice-queue';
import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceSettings,
} from './voice-settings';
import {
  buildBurstTransactionPhrase,
  buildSingleTransactionPhrase,
} from './voice-copy';
import type { BankTransactionCreditData, RealtimeEnvelope } from '../../realtime/realtime.types';

export interface VoiceAnnouncementContextValue {
  settings: VoiceSettings;
  updateSettings: (changes: Partial<VoiceSettings>) => void;
  isSupported: boolean;
  isLeader: boolean;
  isSpeaking: boolean;
  voices: VoiceInfo[];
  handleCreditEvent: (envelope: RealtimeEnvelope<BankTransactionCreditData>) => void;
  testVoice: (customPhrase?: string) => Promise<void>;
  cancelVoice: () => void;
}

const VoiceAnnouncementContext = createContext<VoiceAnnouncementContextValue | null>(null);

export interface VoiceAnnouncementProviderProps {
  children: React.ReactNode;
  engine?: VoiceEngine;
}

export const VoiceAnnouncementProvider: React.FC<VoiceAnnouncementProviderProps> = ({
  children,
  engine: injectedEngine,
}) => {
  const [settings, setSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  const [isLeader, setIsLeader] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);

  const engine = useMemo<VoiceEngine>(() => {
    return injectedEngine || new BrowserSpeechEngine();
  }, [injectedEngine]);

  const queue = useMemo(() => {
    return new VoiceQueue(engine, (state) => {
      setIsSpeaking(state === 'speaking');
    });
  }, [engine]);

  const dedupe = useMemo(() => new VoiceDedupe(), []);

  const leaderManager = useMemo(() => {
    return new MultiTabLeader({
      onLeaderChange: (leader) => setIsLeader(leader),
    });
  }, []);

  const isSupported = useMemo(() => engine.isSupported(), [engine]);

  // Load voices on mount
  useEffect(() => {
    if (isSupported) {
      engine.getVoices().then((v) => setVoices(v));
    }
  }, [engine, isSupported]);

  // Start leader manager on mount
  useEffect(() => {
    leaderManager.start();
    return () => {
      leaderManager.stop();
    };
  }, [leaderManager]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Update settings handler
  const updateSettings = (changes: Partial<VoiceSettings>) => {
    const updated = saveVoiceSettings(changes);
    setSettings(updated);
    if (changes.enabled === false) {
      burstBufferRef.current = [];
      if (burstTimerRef.current) {
        clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
      queue.cancel();
    }
  };

  // Burst aggregation queue
  const burstBufferRef = useRef<Array<{ amount: bigint; desc: string }>>([]);
  const burstTimerRef = useRef<any>(null);

  const processBurstBuffer = () => {
    const currentSettings = settingsRef.current;
    const items = [...burstBufferRef.current];
    burstBufferRef.current = [];
    burstTimerRef.current = null;

    if (!currentSettings.enabled || items.length === 0) return;

    if (items.length === 1 || (items.length <= 3 && currentSettings.burstMode === 'individual')) {
      for (const item of items) {
        const text = buildSingleTransactionPhrase(item.amount.toString(), item.desc, {
          includeDescription: currentSettings.includeDescription,
        });
        queue.enqueue({
          text,
          volume: currentSettings.volume,
          rate: currentSettings.rate,
          pitch: currentSettings.pitch,
          voiceURI: currentSettings.voiceURI,
        });
      }
    } else {
      const total = items.reduce((acc, curr) => acc + curr.amount, 0n);
      const text = buildBurstTransactionPhrase(items.length, total.toString());
      queue.enqueue({
        text,
        volume: currentSettings.volume,
        rate: currentSettings.rate,
        pitch: currentSettings.pitch,
        voiceURI: currentSettings.voiceURI,
      });
    }
  };

  const handleCreditEvent = (envelope: RealtimeEnvelope<BankTransactionCreditData>) => {
    if (!settings.enabled) return;
    if (!isLeader) return;

    // Check if browser tab is hidden and announceWhenHidden is false
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden' &&
      !settings.announceWhenHidden
    ) {
      return;
    }

    const data = envelope.data;
    if (!data) return;

    // Suppress voice announcements for non-realtime sources (CATCH_UP, FILTER_SYNC, BOOTSTRAP)
    if (data.source && data.source !== 'REALTIME') {
      return;
    }

    // Dedupe checks
    const dedupeOpts = {
      eventId: envelope.id,
      transactionId: data.transactionId,
      semanticKey: data.transactionNumber ? `ACB:${data.transactionNumber}` : undefined,
    };

    if (dedupe.has(dedupeOpts)) {
      return;
    }

    // Freshness check: suppress announcements for historical events (> 120s)
    if (!dedupe.isFreshEnough(data.detectedAt)) {
      dedupe.mark(dedupeOpts);
      return;
    }

    dedupe.mark(dedupeOpts);

    // Parse amount
    let amountBigInt = 0n;
    try {
      const cleaned = (data.credit || '0').replace(/[^\d]/g, '');
      amountBigInt = BigInt(cleaned || '0');
    } catch {
      return;
    }

    if (amountBigInt <= 0n) return;

    // Push into burst buffer (750ms collection window)
    burstBufferRef.current.push({
      amount: amountBigInt,
      desc: data.description || '',
    });

    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
    }
    burstTimerRef.current = setTimeout(processBurstBuffer, 750);
  };

  const testVoice = async (customPhrase?: string) => {
    queue.cancel();
    const testText =
      customPhrase || 'Đã bật đọc giao dịch mới. Bạn vừa nhận được năm trăm nghìn đồng.';
    queue.enqueue({
      text: testText,
      volume: settings.volume,
      rate: settings.rate,
      pitch: settings.pitch,
      voiceURI: settings.voiceURI,
    });
  };

  const cancelVoice = () => {
    queue.cancel();
    burstBufferRef.current = [];
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
  };

  const value: VoiceAnnouncementContextValue = useMemo(() => {
    return {
      settings,
      updateSettings,
      isSupported,
      isLeader,
      isSpeaking,
      voices,
      handleCreditEvent,
      testVoice,
      cancelVoice,
    };
  }, [settings, isSupported, isLeader, isSpeaking, voices]);

  return (
    <VoiceAnnouncementContext.Provider value={value}>
      {children}
    </VoiceAnnouncementContext.Provider>
  );
};

export function useVoiceAnnouncements(): VoiceAnnouncementContextValue {
  const ctx = useContext(VoiceAnnouncementContext);
  if (!ctx) {
    throw new Error('useVoiceAnnouncements must be used within a VoiceAnnouncementProvider');
  }
  return ctx;
}
