import React from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';
import { useVoiceAnnouncements } from '../VoiceAnnouncementProvider';
import { VoiceTestButton } from './VoiceTestButton';

export interface VoiceSettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VoiceSettingsSheet: React.FC<VoiceSettingsSheetProps> = ({ isOpen, onClose }) => {
  const { settings, updateSettings, isSupported, voices } = useVoiceAnnouncements();

  if (!isOpen) return null;

  const vietnameseVoices = voices.filter(
    (v) => v.lang.toLowerCase().includes('vi') || v.lang.toLowerCase().includes('vn')
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-stone-900">Cài đặt đọc giao dịch</h3>
              <p className="text-xs text-stone-500">Phát âm thanh khi có tiền vào tài khoản</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-5">
          {!isSupported ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-start gap-2.5">
              <VolumeX className="w-5 h-5 shrink-0 text-amber-600" />
              <span>Trình duyệt hoặc thiết bị này chưa hỗ trợ đọc bằng giọng nói Web Speech.</span>
            </div>
          ) : (
            <>
              {/* Enable Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-stone-200/70">
                <div>
                  <span className="text-sm font-medium text-stone-900 block">
                    Đọc giao dịch mới
                  </span>
                  <span className="text-xs text-stone-500">
                    Tự động đọc số tiền ngay khi giao dịch được ghi nhận
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.enabled}
                  aria-label="Bật đọc giao dịch"
                  onClick={() => updateSettings({ enabled: !settings.enabled })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    settings.enabled ? 'bg-emerald-600' : 'bg-stone-300'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                      settings.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Voice selection */}
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1.5">
                  Giọng đọc (Tiếng Việt)
                </label>
                <select
                  value={settings.voiceURI || ''}
                  onChange={(e) => updateSettings({ voiceURI: e.target.value || undefined })}
                  disabled={!settings.enabled}
                  className="w-full text-sm rounded-lg border border-stone-300 px-3 py-2 bg-white text-stone-800 disabled:bg-stone-100 disabled:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Tự động chọn giọng tiếng Việt phù hợp nhất</option>
                  {vietnameseVoices.map((v) => (
                    <option key={v.uri} value={v.uri}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                  {vietnameseVoices.length === 0 &&
                    voices.map((v) => (
                      <option key={v.uri} value={v.uri}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                </select>
              </div>

              {/* Volume Slider */}
              <div>
                <div className="flex justify-between text-xs font-medium text-stone-700 mb-1">
                  <span>Âm lượng</span>
                  <span>{Math.round(settings.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.volume}
                  disabled={!settings.enabled}
                  onChange={(e) => updateSettings({ volume: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-600 cursor-pointer disabled:opacity-50"
                />
              </div>

              {/* Speech Rate Slider */}
              <div>
                <div className="flex justify-between text-xs font-medium text-stone-700 mb-1">
                  <span>Tốc độ đọc</span>
                  <span>{settings.rate}x</span>
                </div>
                <input
                  type="range"
                  min="0.75"
                  max="1.5"
                  step="0.05"
                  value={settings.rate}
                  disabled={!settings.enabled}
                  onChange={(e) => updateSettings({ rate: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-600 cursor-pointer disabled:opacity-50"
                />
              </div>

              {/* Include Description checkbox */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.includeDescription}
                  disabled={!settings.enabled}
                  onChange={(e) => updateSettings({ includeDescription: e.target.checked })}
                  className="mt-0.5 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                />
                <div>
                  <span className="text-sm font-medium text-stone-800 block">
                    Đọc kèm nội dung chuyển khoản
                  </span>
                  <span className="text-xs text-stone-500">
                    Phát thêm nội dung tin nhắn giao dịch sau khi đọc số tiền
                  </span>
                </div>
              </label>

              {/* Announce when tab is in background */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.announceWhenHidden}
                  disabled={!settings.enabled}
                  onChange={(e) => updateSettings({ announceWhenHidden: e.target.checked })}
                  className="mt-0.5 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                />
                <div>
                  <span className="text-sm font-medium text-stone-800 block">
                    Đọc cả khi chuyển tab khác
                  </span>
                  <span className="text-xs text-stone-500">
                    Tiếp tục thông báo khi ứng dụng đang mở ở tab nền
                  </span>
                </div>
              </label>
            </>
          )}

          {/* Modal Actions */}
          <div className="pt-4 border-t border-stone-100 flex items-center justify-between gap-3">
            <VoiceTestButton />
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
