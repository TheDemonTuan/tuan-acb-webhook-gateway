import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  RotateCcw,
  Send,
  ShieldAlert,
  RefreshCw,
  Clock,
} from 'lucide-react';
import {
  fetchAuditLogs,
  fetchDeliveries,
  fetchPollRuns,
} from '../../shared/api/queries';
import { queryKeys } from '../../shared/api/query-keys';
import { getDeliveryStatus, getPollStatus } from '../../content/status-copy';

export const ActivityPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: 'polling' | 'deliveries' | 'audit' =
    tabParam === 'deliveries' ? 'deliveries' : tabParam === 'audit' ? 'audit' : 'polling';

  const switchTab = (tab: 'polling' | 'deliveries' | 'audit') => {
    setSearchParams({ tab });
  };

  const { data: pollData, isLoading: loadingPolls, refetch: refetchPolls } = useQuery({
    queryKey: queryKeys.pollRuns(),
    queryFn: () => fetchPollRuns({ limit: 50 }),
  });

  const { data: deliveryData, isLoading: loadingDeliveries, refetch: refetchDeliveries } = useQuery({
    queryKey: queryKeys.deliveries(),
    queryFn: () => fetchDeliveries({ limit: 50 }),
  });

  const { data: auditData, isLoading: loadingAudit, refetch: refetchAudit } = useQuery({
    queryKey: queryKeys.auditLogs(),
    queryFn: () => fetchAuditLogs({ limit: 50 }),
  });

  const polls = pollData?.items || [];
  const deliveries = deliveryData?.items || [];
  const audits = auditData?.items || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">Hoạt động</h2>
          <p className="text-sm text-stone-500 mt-0.5">
            Lịch sử chu kỳ cập nhật, phân phối webhook và nhật ký hệ thống
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            refetchPolls();
            refetchDeliveries();
            refetchAudit();
          }}
          className="inline-flex items-center self-start sm:self-auto gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 transition shadow-2xs cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Làm mới</span>
        </button>
      </div>

      {/* Navigation Sub-tabs */}
      <div className="flex items-center gap-2 border-b border-stone-200 pb-2">
        <button
          type="button"
          onClick={() => switchTab('polling')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
            activeTab === 'polling'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200/80'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Chu kỳ cập nhật</span>
        </button>

        <button
          type="button"
          onClick={() => switchTab('deliveries')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
            activeTab === 'deliveries'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200/80'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Lịch sử gửi</span>
        </button>

        <button
          type="button"
          onClick={() => switchTab('audit')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
            activeTab === 'audit'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200/80'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Nhật ký kiểm toán</span>
        </button>
      </div>

      {/* TAB 1: Polling Runs */}
      {activeTab === 'polling' && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
            <h3 className="font-bold text-stone-900 text-base">Chu kỳ Polling</h3>
            <span className="text-xs text-stone-500">{polls.length} lượt chạy gần nhất</span>
          </div>

          {polls.length === 0 ? (
            <div className="p-12 text-center text-xs text-stone-500">
              {loadingPolls ? 'Đang tải dữ liệu...' : 'Chưa có chu kỳ polling nào được ghi nhận.'}
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {polls.map((p) => {
                const pollStatus = getPollStatus(p.status);
                return (
                  <div
                    key={p.id}
                    className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/50 transition"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${
                            pollStatus.tone === 'success'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : pollStatus.tone === 'warning'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {pollStatus.label}
                        </span>
                        <span className="text-xs text-stone-500 flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
                          {new Date(p.startedAt).toLocaleString('vi-VN')}
                        </span>
                      </div>
                      {p.error && (
                        <p className="text-xs text-rose-600 font-mono mt-0.5">{p.error}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-stone-600 font-mono">
                      <span>Trang: {p.pages}</span>
                      <span>Số dòng quét: {p.rowsSeen}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Deliveries */}
      {activeTab === 'deliveries' && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
            <h3 className="font-bold text-stone-900 text-base">Phân phối Webhook</h3>
            <span className="text-xs text-stone-500">{deliveries.length} lượt gửi</span>
          </div>

          {deliveries.length === 0 ? (
            <div className="p-12 text-center text-xs text-stone-500">
              {loadingDeliveries ? 'Đang tải dữ liệu...' : 'Chưa có bản ghi phân phối webhook nào.'}
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {deliveries.map((d) => {
                const deliveryStatus = getDeliveryStatus(d.status);
                return (
                  <div
                    key={d.id}
                    className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/50 transition"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${
                            deliveryStatus.tone === 'success'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : deliveryStatus.tone === 'warning'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {deliveryStatus.label}
                        </span>
                        <span className="text-xs text-stone-500 font-mono">
                          Số lần gửi: {d.attempts}
                        </span>
                      </div>
                      <span className="text-xs text-stone-500 block">
                        Kênh nhận: <span className="font-mono">{d.endpointId}</span> &middot; Mã sự kiện: <span className="font-mono">{d.eventId}</span>
                      </span>
                    </div>

                    <div className="text-xs text-stone-500 font-mono">
                      {new Date(d.createdAt).toLocaleString('vi-VN')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Audit Log */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
            <h3 className="font-bold text-stone-900 text-base">Audit Logs</h3>
            <span className="text-xs text-stone-500">{audits.length} bản ghi</span>
          </div>

          {audits.length === 0 ? (
            <div className="p-12 text-center text-xs text-stone-500">
              {loadingAudit ? 'Đang tải dữ liệu...' : 'Chưa có bản ghi audit nào.'}
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {audits.map((a) => (
                <div
                  key={a.id}
                  className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/50 transition"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-stone-800 text-xs">{a.action}</span>
                      <span className="text-xs text-stone-400 font-mono">
                        {a.subject} ({a.role})
                      </span>
                    </div>
                    <span className="text-xs text-stone-500 font-mono block mt-0.5">
                      Đối tượng: {a.target}
                    </span>
                  </div>
                  <div className="text-xs text-stone-400 font-mono">
                    {new Date(a.createdAt).toLocaleString('vi-VN')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
