import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  QrCode,
  X,
  Copy,
  Check,
  Building2,
  User,
  CreditCard,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { fetchPaymentQR } from '../../shared/api/queries';
import { queryKeys } from '../../shared/api/query-keys';
import { useRealtimeContext } from '../../realtime/RealtimeProvider';
import type { BankTransactionCreditData, RealtimeEnvelope } from '../../realtime/realtime.types';
import { formatVndCurrency } from '../../shared/formatters/money';

export const ReceivingQRModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [latestCredit, setLatestCredit] = useState<{
    id: string;
    amount: number;
    description: string;
    time: string;
  } | null>(null);

  const { subscribe } = useRealtimeContext();

  const { data } = useQuery({
    queryKey: queryKeys.paymentQR,
    queryFn: fetchPaymentQR,
    enabled: isOpen,
  });

  const qr = data?.qr;
  const isConfigured = data?.configured && data?.hasImage;

  // Listen to realtime credit transactions while modal is open
  useEffect(() => {
    if (!isOpen) {
      setLatestCredit(null);
      return;
    }

    const unsub = subscribe<BankTransactionCreditData>(
      'bank.transaction.credit',
      (envelope: RealtimeEnvelope<BankTransactionCreditData>) => {
        const d = envelope.data;
        if (!d) return;

        const creditVal = Number(d.credit || 0);
        if (creditVal > 0) {
          setLatestCredit({
            id: d.transactionId,
            amount: creditVal,
            description: d.description || 'Chuyển khoản nhận tiền',
            time: new Date().toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          });
        }
      }
    );

    return () => unsub();
  }, [isOpen, subscribe]);

  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = (text: string) => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-md sm:max-w-lg rounded-3xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-base leading-tight">Quét mã nhận tiền ACB</h3>
              <p className="text-[11px] text-stone-500">Hỗ trợ tất cả ngân hàng qua VietQR 24/7</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 rounded-xl hover:bg-stone-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content with smooth scrolling if needed */}
        <div className="p-6 overflow-y-auto text-center space-y-4">
          {/* Live Credit Toast Banner if money arrived while modal was open */}
          {latestCredit && (
            <div className="bg-emerald-500 text-white rounded-2xl p-4 shadow-lg border border-emerald-400 text-left animate-in slide-in-from-top-3 fade-in duration-200 relative overflow-hidden">
              <div className="absolute right-0 top-0 bottom-0 w-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-start justify-between gap-3 relative z-10">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-6 h-6 text-white animate-bounce" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-100">
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      <span>Vừa nhận được tiền! ({latestCredit.time})</span>
                    </div>
                    <p className="text-2xl font-black tracking-tight mt-0.5 text-white">
                      +{formatVndCurrency(latestCredit.amount)}
                    </p>
                    <p className="text-xs text-emerald-100 mt-1 line-clamp-2">
                      {latestCredit.description}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setLatestCredit(null)}
                  className="p-1 text-white/70 hover:text-white rounded-lg transition cursor-pointer shrink-0"
                  title="Đóng thông báo"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {isConfigured ? (
            <>
              {/* Enlarged High-contrast QR Image Box */}
              <div className="bg-stone-50 p-4 sm:p-5 rounded-3xl border border-stone-200 inline-block shadow-sm">
                <div className="bg-white p-2 rounded-2xl shadow-xs border border-stone-100">
                  <img
                    src={data.imageURL}
                    alt="Mã QR nhận tiền ACB"
                    className="w-64 h-64 sm:w-76 sm:h-76 object-contain mx-auto rounded-xl"
                  />
                </div>
              </div>

              {/* Account Details Box */}
              <div className="bg-stone-50 rounded-2xl p-4 space-y-2.5 text-xs text-left border border-stone-200/70">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1.5 font-medium">
                    <Building2 className="w-4 h-4 text-stone-400" />
                    Ngân hàng
                  </span>
                  <span className="font-bold text-stone-800 text-sm">{qr.bankName} (Á Châu)</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1.5 font-medium">
                    <CreditCard className="w-4 h-4 text-stone-400" />
                    Số tài khoản
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-black text-emerald-700 text-base tracking-wide">
                      {qr.accountNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(qr.accountNumber)}
                      className="p-1 hover:text-stone-900 cursor-pointer text-stone-400 hover:bg-stone-200/60 rounded-md transition"
                      title="Sao chép số tài khoản"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1.5 font-medium">
                    <User className="w-4 h-4 text-stone-400" />
                    Chủ tài khoản
                  </span>
                  <span className="font-black text-stone-900 uppercase text-sm">
                    {qr.accountName}
                  </span>
                </div>
              </div>

              <p className="text-xs text-stone-500">
                Quét mã bằng ứng dụng ngân hàng bất kỳ. Tiền vào sẽ được cập nhật và thông báo tức thì ngay trên màn hình này.
              </p>
            </>
          ) : (
            <div className="py-12 space-y-3">
              <QrCode className="w-14 h-14 text-stone-300 mx-auto stroke-1" />
              <p className="text-sm font-semibold text-stone-700">Chưa thiết lập mã QR</p>
              <p className="text-xs text-stone-400 max-w-xs mx-auto">
                Chủ tài khoản có thể cấu hình mã QR nhận tiền trong phần Quản trị hệ thống &rarr; Kết nối ACB.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-stone-50 border-t border-stone-100 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-stone-900 text-white hover:bg-stone-800 transition shadow-xs cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
