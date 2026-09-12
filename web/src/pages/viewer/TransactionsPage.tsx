import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Clock,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Receipt,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { fetchTransactions } from '../../shared/api/queries';
import { queryKeys } from '../../shared/api/query-keys';
import { formatVndCurrency } from '../../shared/formatters/money';
import type { Transaction } from '../../realtime-types';

export const TransactionsPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all');
  const [dateRange, setDateRange] = useState<'today' | '7days' | 'all'>('all');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: queryKeys.transactions({ limit: 100 }),
    queryFn: () => fetchTransactions({ limit: 100 }),
  });

  const transactions = useMemo(() => data?.items || [], [data?.items]);

  // Check if a date string falls on the same calendar day (local timezone)
  const isToday = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return false;
    const today = new Date();
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  };

  const isWithinDays = (dateStr: string | undefined, days: number) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return false;
    const diff = Date.now() - d.getTime();
    return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
  };

  // Compute stats for today strictly based on calendar date
  const stats = useMemo(() => {
    let incomingToday = 0;
    let outgoingToday = 0;
    let countToday = 0;

    for (const tx of transactions) {
      const txDate = tx.transactionDate || tx.firstSeenAt;
      if (isToday(txDate)) {
        countToday++;
        if (tx.credit > 0) incomingToday += tx.credit;
        if (tx.debit > 0) outgoingToday += tx.debit;
      }
    }

    return { incomingToday, outgoingToday, countToday, totalCount: transactions.length };
  }, [transactions]);

  // Filter list by date, type, and search
  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      const txDate = tx.transactionDate || tx.firstSeenAt;

      // Date range filter
      if (dateRange === 'today' && !isToday(txDate)) return false;
      if (dateRange === '7days' && !isWithinDays(txDate, 7)) return false;

      // Direction filter
      if (filterType === 'credit' && tx.credit <= 0) return false;
      if (filterType === 'debit' && tx.debit <= 0) return false;

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const descMatch = tx.description?.toLowerCase().includes(q);
        const creditMatch = tx.credit.toString().includes(q);
        const debitMatch = tx.debit.toString().includes(q);
        const keyMatch = tx.semanticKey?.toLowerCase().includes(q);
        if (!descMatch && !creditMatch && !debitMatch && !keyMatch) return false;
      }

      return true;
    });
  }, [transactions, filterType, dateRange, search]);

  const handleCopy = (text: string) => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(text);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top section with heading & quick actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">Giao dịch</h2>
          <p className="text-sm text-stone-600 mt-0.5">
            Danh sách giao dịch ngân hàng được cập nhật tự động tức thì
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading || isRefetching}
          className="inline-flex items-center self-start sm:self-auto gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 transition shadow-2xs cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          <span>Làm mới</span>
        </button>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-600 uppercase tracking-wider">
              Tiền vào hôm nay
            </span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold tracking-tight text-emerald-600">
              +{formatVndCurrency(stats.incomingToday)}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-600 uppercase tracking-wider">
              Tiền ra hôm nay
            </span>
            <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold tracking-tight text-rose-600">
              -{formatVndCurrency(stats.outgoingToday)}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-600 uppercase tracking-wider">
              Giao dịch hôm nay
            </span>
            <div className="p-2 rounded-xl bg-stone-100 text-stone-600">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold tracking-tight text-stone-900">
              {stats.countToday}
            </span>
            <span className="text-xs text-stone-600 ml-1.5 font-medium">
              hôm nay ({stats.totalCount} tổng)
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-2xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative w-full flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Tìm theo nội dung, số tiền, mã giao dịch..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-stone-200 bg-stone-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
          />
        </div>

        {/* Date Filter */}
        <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setDateRange('today')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              dateRange === 'today' ? 'bg-white text-stone-900 shadow-2xs font-semibold' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Hôm nay
          </button>
          <button
            type="button"
            onClick={() => setDateRange('7days')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              dateRange === '7days' ? 'bg-white text-stone-900 shadow-2xs font-semibold' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            7 ngày
          </button>
          <button
            type="button"
            onClick={() => setDateRange('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              dateRange === 'all' ? 'bg-white text-stone-900 shadow-2xs font-semibold' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Tất cả
          </button>
        </div>

        {/* Type Filter */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer whitespace-nowrap ${
              filterType === 'all'
                ? 'bg-stone-900 text-white shadow-2xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70'
            }`}
          >
            Tất cả ({transactions.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('credit')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer whitespace-nowrap ${
              filterType === 'credit'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'bg-stone-100 text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            Tiền vào
          </button>
          <button
            type="button"
            onClick={() => setFilterType('debit')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer whitespace-nowrap ${
              filterType === 'debit'
                ? 'bg-rose-600 text-white shadow-2xs'
                : 'bg-stone-100 text-rose-700 hover:bg-rose-50'
            }`}
          >
            Tiền ra
          </button>
        </div>
      </div>

      {/* Transaction List */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt className="w-10 h-10 text-stone-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-stone-800">Chưa có dữ liệu giao dịch</p>
            <p className="text-xs text-stone-600 mt-1 max-w-sm mx-auto">
              {search
                ? 'Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc để xem các giao dịch khác.'
                : 'Chưa có giao dịch nào được ghi nhận. Khi có giao dịch mới, danh sách sẽ tự động cập nhật ngay.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {filtered.map((tx, idx) => {
              const isCredit = tx.credit > 0;
              const formattedDate = tx.transactionDate
                ? new Date(tx.transactionDate).toLocaleString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })
                : 'Gần đây';

              return (
                <div
                  key={tx.id || tx.semanticKey || idx}
                  onClick={() => setSelectedTx(tx)}
                  className="p-4 sm:px-6 hover:bg-stone-50/80 transition cursor-pointer flex items-center justify-between gap-4 group"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isCredit
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                          : 'bg-rose-50 text-rose-600 border border-rose-100'
                      }`}
                    >
                      {isCredit ? (
                        <ArrowDownLeft className="w-5 h-5" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-md ${
                            isCredit
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {isCredit ? 'Tiền vào' : 'Tiền ra'}
                        </span>
                        <span className="text-xs text-stone-600 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formattedDate}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-stone-900 mt-1 truncate max-w-md sm:max-w-xl">
                        {tx.description || 'Không có nội dung chuyển khoản'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-right">
                    <div>
                      <span
                        className={`text-base font-bold block ${
                          isCredit ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {isCredit
                          ? `+${formatVndCurrency(tx.credit)}`
                          : `-${formatVndCurrency(tx.debit)}`}
                      </span>
                      {typeof tx.balance === 'number' && (
                        <span className="text-[11px] text-stone-600 font-medium">
                          Số dư: {formatVndCurrency(tx.balance)}
                        </span>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-stone-400 group-hover:text-stone-600 group-hover:translate-x-0.5 transition hidden sm:block" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
              <h3 className="font-semibold text-stone-900">Chi tiết giao dịch</h3>
              <button
                type="button"
                onClick={() => setSelectedTx(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="text-center py-2">
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    selectedTx.credit > 0
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}
                >
                  {selectedTx.credit > 0 ? 'Tiền vào' : 'Tiền ra'}
                </span>
                <div
                  className={`text-3xl font-extrabold mt-3 tracking-tight ${
                    selectedTx.credit > 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {selectedTx.credit > 0
                    ? `+${formatVndCurrency(selectedTx.credit)}`
                    : `-${formatVndCurrency(selectedTx.debit)}`}
                </div>
                <div className="text-xs text-stone-600 mt-1">
                  {selectedTx.transactionDate
                    ? new Date(selectedTx.transactionDate).toLocaleString('vi-VN')
                    : 'Gần đây'}
                </div>
              </div>

              <div className="bg-stone-50 rounded-xl p-4 space-y-3 border border-stone-200/60 text-sm">
                <div>
                  <span className="text-xs font-medium text-stone-600 block">
                    Nội dung giao dịch
                  </span>
                  <p className="font-medium text-stone-900 mt-0.5 break-words">
                    {selectedTx.description || '(Không có nội dung)'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-stone-200/60">
                  <div>
                    <span className="text-xs font-medium text-stone-600 block">
                      Mã tham chiếu / Semantic Key
                    </span>
                    <span className="font-mono text-xs text-stone-800 break-all">
                      {selectedTx.semanticKey || selectedTx.id}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-stone-600 block">Thời điểm ghi nhận</span>
                    <span className="text-xs text-stone-800">
                      {selectedTx.firstSeenAt
                        ? new Date(selectedTx.firstSeenAt).toLocaleString('vi-VN')
                        : 'Ngay tức thì'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4 bg-stone-50 border-t border-stone-100">
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    `${selectedTx.credit > 0 ? '+' : '-'}${selectedTx.credit || selectedTx.debit} VND\n${selectedTx.description}\nMã: ${selectedTx.semanticKey || selectedTx.id}`
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 transition shadow-2xs cursor-pointer"
              >
                {copiedId ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Đã sao chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép thông tin</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSelectedTx(null)}
                className="px-4 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
