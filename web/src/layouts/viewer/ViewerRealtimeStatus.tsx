import React from 'react';
import { useRealtimeStatus } from '../../realtime/useRealtimeStatus';

export const ViewerRealtimeStatus: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { status, label, tooltip, isOnline } = useRealtimeStatus();

  return (
    <div
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border ${
        isOnline
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : status === 'RECONNECTING' || status === 'CONNECTING'
          ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
          : 'bg-rose-50 text-rose-700 border-rose-200'
      } ${className}`}
      title={tooltip}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          isOnline
            ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
            : status === 'RECONNECTING' || status === 'CONNECTING'
            ? 'bg-amber-500'
            : 'bg-rose-500'
        }`}
      />
      <span>{label}</span>
    </div>
  );
};
