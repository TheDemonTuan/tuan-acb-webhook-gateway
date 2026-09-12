import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TransactionsPage } from './TransactionsPage';

export const TransactionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-4">
      <Link
        to="/transactions"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 hover:text-stone-900 transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Quay lại danh sách giao dịch
      </Link>
      <div className="bg-white p-4 rounded-xl border border-stone-200 text-xs text-stone-500">
        Đang xem chi tiết giao dịch: <span className="font-mono text-stone-900 font-semibold">{id}</span>
      </div>
      <TransactionsPage />
    </div>
  );
};
