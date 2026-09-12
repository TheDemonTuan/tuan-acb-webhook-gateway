import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RealtimeClient } from './realtime.client';
import type { RealtimeEnvelope, RealtimeEventType, RealtimeListener, RealtimeStatus } from './realtime.types';

export interface RealtimeContextValue {
  status: RealtimeStatus;
  lastEventAt: Date | null;
  watermark: number | null;
  subscribe: <T = unknown>(type: RealtimeEventType, listener: RealtimeListener<T>) => () => void;
  onAny: (listener: RealtimeListener<any>) => () => void;
  client: RealtimeClient | null;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export interface RealtimeProviderProps {
  children: React.ReactNode;
  url?: string;
  onInitialState?: (watermark: number) => void;
  onResetState?: (reason: string) => void;
}

export const RealtimeProvider: React.FC<RealtimeProviderProps> = ({
  children,
  url,
  onInitialState,
  onResetState,
}) => {
  const [status, setStatus] = useState<RealtimeStatus>('CONNECTING');
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [watermark, setWatermark] = useState<number | null>(null);

  const callbacksRef = useRef({ onInitialState, onResetState });
  callbacksRef.current = { onInitialState, onResetState };

  const client = useMemo(() => {
    return new RealtimeClient({
      url,
      onStatusChange: (nextStatus) => {
        setStatus(nextStatus);
      },
      onInitialState: (wm) => {
        setWatermark(wm);
        setLastEventAt(new Date());
        callbacksRef.current.onInitialState?.(wm);
      },
      onResetState: (reason) => {
        callbacksRef.current.onResetState?.(reason);
      },
    });
  }, [url]);

  useEffect(() => {
    client.connect();

    const unsub = client.onAny(() => {
      setLastEventAt(new Date());
    });

    return () => {
      unsub();
      client.disconnect();
    };
  }, [client]);

  const subscribe = useCallback(
    <T = unknown>(type: RealtimeEventType, listener: RealtimeListener<T>) => {
      return client.subscribe(type, listener);
    },
    [client]
  );

  const onAny = useCallback(
    (listener: RealtimeListener<any>) => {
      return client.onAny(listener);
    },
    [client]
  );

  const value: RealtimeContextValue = useMemo(() => {
    return {
      status,
      lastEventAt,
      watermark,
      subscribe,
      onAny,
      client,
    };
  }, [status, lastEventAt, watermark, client, subscribe, onAny]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
};

export function useRealtimeContext(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error('useRealtimeContext must be used within a RealtimeProvider');
  }
  return ctx;
}

export function useRealtimeSubscription<T = unknown>(
  type: RealtimeEventType,
  listener: (envelope: RealtimeEnvelope<T>) => void,
  deps: React.DependencyList = []
): void {
  const { subscribe } = useRealtimeContext();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    return subscribe<T>(type, (env) => {
      listenerRef.current(env);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, type, ...deps]);
}
