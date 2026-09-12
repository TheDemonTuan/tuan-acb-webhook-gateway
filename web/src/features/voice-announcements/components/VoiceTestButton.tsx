import React, { useState } from 'react';
import { Play } from 'lucide-react';
import { useVoiceAnnouncements } from '../VoiceAnnouncementProvider';

export const VoiceTestButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { testVoice, unlockAudio, isSupported } = useVoiceAnnouncements();
  const [testing, setTesting] = useState(false);

  const handleClick = async () => {
    setTesting(true);
    try {
      await unlockAudio();
      await testVoice();
    } finally {
      setTimeout(() => setTesting(false), 1500);
    }
  };

  if (!isSupported) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={testing}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 transition cursor-pointer disabled:opacity-50 ${className}`}
    >
      <Play className="w-3.5 h-3.5 fill-current" />
      {testing ? 'Đang phát...' : 'Nghe thử'}
    </button>
  );
};
