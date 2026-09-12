import { useEffect, useRef, useState } from 'react';
import type { RealtimeStatus } from './realtime-types';

export type RealtimeHandlers = {
  onEvent?: (type: string, data: unknown) => void;
  onInitialState?: (watermark: number) => void;
  onResetState?: (reason: string) => void;
};

const eventTypes = [
  'bank.transaction.credit',
  'connection.changed',
  'auth.changed',
  'webhook.changed',
  'delivery.changed',
  'poll.completed',
  'audit.created',
  'stream_error',
] as const;

export const useRealtime = (handlers: RealtimeHandlers) => {
  const [status, setStatus] = useState<RealtimeStatus>('CONNECTING');
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const source = new EventSource('/api/v1/events');
    let cancelled = false;

    source.onopen = () => {
      if (!cancelled) {
        setStatus('CONNECTED');
        setLastEventAt(new Date());
      }
    };
    source.onerror = () => {
      if (!cancelled) setStatus('RECONNECTING');
    };

    source.addEventListener('initial_state', (event: MessageEvent) => {
      if (cancelled) return;
      setLastEventAt(new Date());
      try {
        const data = JSON.parse(event.data);
        handlersRef.current.onInitialState?.(data.watermark);
      } catch {}
    });
    source.addEventListener('reset_state', (event: MessageEvent) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(event.data);
        handlersRef.current.onResetState?.(data.reason ?? 'unknown');
      } catch {
        handlersRef.current.onResetState?.('unknown');
      }
    });
    for (const type of eventTypes) {
      source.addEventListener(type, (event: MessageEvent) => {
        if (cancelled) return;
        setLastEventAt(new Date());
        try {
          handlersRef.current.onEvent?.(type, JSON.parse(event.data));
        } catch {}
      });
    }

    return () => {
      cancelled = true;
      source.close();
      setStatus('DISCONNECTED');
    };
  }, []);

  return { status, lastEventAt };
};
