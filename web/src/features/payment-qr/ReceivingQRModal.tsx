import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  QrCode,
  X,
  Copy,
  Check,
  Download,
  Building2,
  User,
  CreditCard,
} from 'lucide-react';
import { fetchPaymentQR } from '../../shared/api/queries';
import { queryKeys } from '../../shared/api/query-keys';

export const ReceivingQRModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  const { data } = useQuery({
    queryKey: queryKeys.paymentQR,
    queryFn: fetchPaymentQR,
    enabled: isOpen,
  });

  const qr = data?.qr;
  const isConfigured = data?.configured && data?.hasImage;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-sm rounded-3xl shadow-2xl border border-stone-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-stone-900 text-sm">Quét mã nhận tiền ACB</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 text-center space-y-4">
          {isConfigured ? (
            <>
              {/* QR Image Box */}
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 inline-block shadow-xs">
                <img
                  src={data.imageURL}
                  alt="Mã QR nhận tiền ACB"
                  className="w-52 h-52 object-contain mx-auto rounded-xl"
                />
              </div>

              {/* Account Details */}
              <div className="bg-stone-50 rounded-2xl p-3.5 space-y-2.5 text-xs text-left border border-stone-100">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-stone-400" />
                    Ngân hàng
                  </span>
                  <span className="font-bold text-stone-800">{qr.bankName} (Á Châu)</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-stone-400" />
                    Số tài khoản
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="font-mono font-bold text-emerald-700 text-sm">
                      {qr.accountNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(qr.accountNumber)}
                      className="p-1 hover:text-stone-900 cursor-pointer text-stone-400"
                      title="Sao chép số tài khoản"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-stone-400" />
                    Chủ tài khoản
                  </span>
                  <span className="font-bold text-stone-900 uppercase">
                    {qr.accountName}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-stone-400">
                Quét bằng ứng dụng ngân hàng bất kỳ (VietQR) để chuyển tiền vào tài khoản ngay lập tức.
              </p>
            </>
          ) : (
            <div className="py-8 space-y-3">
              <QrCode className="w-12 h-12 text-stone-300 mx-auto" />
              <p className="text-xs font-semibold text-stone-700">Chưa thiết lập mã QR</p>
              <p className="text-[11px] text-stone-400 max-w-xs mx-auto">
                Chủ tài khoản có thể cấu hình mã QR nhận tiền trong phần Quản trị hệ thống &rarr; Kết nối ACB.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-stone-50 border-t border-stone-100 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 text-white hover:bg-stone-800 transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
