import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Plus,
  Power,
  RefreshCw,
  Key,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  createWebhookEndpoint,
  fetchWebhooks,
  toggleWebhookEndpoint,
} from '../../shared/api/queries';
import { queryKeys } from '../../shared/api/query-keys';
import { formatErrorMessage } from '../../content/error-copy';

export const NotificationChannelsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.webhooks,
    queryFn: fetchWebhooks,
  });

  const endpoints = data?.items || [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;

    setIsCreating(true);
    setNotice(null);
    setErrorNotice(null);

    try {
      await createWebhookEndpoint(name.trim(), url.trim());
      setNotice('Đã tạo endpoint ở trạng thái DISABLED.');
      setName('');
      setUrl('');
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks });
      setTimeout(() => setNotice(null), 5000);
    } catch (err) {
      setErrorNotice(formatErrorMessage(err));
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (id: string, currentStatus: string) => {
    setTogglingId(id);
    const action = currentStatus === 'ACTIVE' ? 'disable' : 'enable';
    try {
      await toggleWebhookEndpoint(id, action);
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks });
    } catch (err) {
      setErrorNotice(formatErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  };

  const toggleSecret = (id: string) => {
    setRevealedSecrets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">
            Webhook endpoints
          </h2>
          <p className="text-sm text-stone-500 mt-0.5">
            Quản lý các URL đích nhận thông báo đẩy khi có giao dịch ngân hàng mới
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading}
          className="inline-flex items-center self-start sm:self-auto gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 transition shadow-2xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Làm mới</span>
        </button>
      </div>

      {/* Notices */}
      {notice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {errorNotice && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
          <span>{errorNotice}</span>
        </div>
      )}

      {/* Create New Endpoint Form */}
      <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-2xs">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 rounded-xl bg-stone-100 text-stone-700">
            <Plus className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-stone-900 text-base">Tạo Webhook endpoint mới</h3>
        </div>

        <form onSubmit={handleCreate} className="space-y-4 max-w-xl">
          <div>
            <label htmlFor="endpointName" className="block text-xs font-medium text-stone-700 mb-1">
              Tên endpoint
            </label>
            <input
              id="endpointName"
              type="text"
              required
              placeholder="ví dụ: Máy chủ xử lý đơn hàng"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div>
            <label htmlFor="endpointUrl" className="block text-xs font-medium text-stone-700 mb-1">
              HTTPS URL
            </label>
            <input
              id="endpointUrl"
              type="url"
              required
              placeholder="https://api.yourdomain.com/webhooks/acb"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={isCreating}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-stone-900 text-white hover:bg-stone-800 transition shadow-xs cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isCreating ? 'Đang tạo...' : 'Tạo endpoint'}</span>
          </button>
        </form>
      </div>

      {/* Endpoints List */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
          <h3 className="font-bold text-stone-900 text-sm">Danh sách webhook đã đăng ký</h3>
          <span className="text-xs text-stone-500">{endpoints.length} endpoints</span>
        </div>

        {endpoints.length === 0 ? (
          <div className="p-12 text-center">
            <Bell className="w-10 h-10 text-stone-300 mx-auto mb-3" />
            <h4 className="text-sm font-semibold text-stone-800">Chưa có Webhook endpoint nào</h4>
            <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto">
              Tạo endpoint đầu tiên ở biểu mẫu trên để bắt đầu nhận sự kiện giao dịch.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {endpoints.map((ep) => {
              const isActive = ep.status === 'ACTIVE';
              const isToggling = togglingId === ep.id;
              const secretVisible = Boolean(revealedSecrets[ep.id]);

              return (
                <div
                  key={ep.id}
                  className="p-5 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50/50 transition"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-stone-900 text-sm">{ep.name}</span>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-md ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-stone-100 text-stone-600 border border-stone-200'
                        }`}
                      >
                        {ep.status}
                      </span>
                      <span className="text-[11px] text-stone-400">
                        Phiên bản rev.{ep.revision}
                      </span>
                    </div>

                    <p className="text-xs font-mono text-stone-600 break-all">{ep.url}</p>

                    {ep.secret && (
                      <div className="flex items-center gap-2 pt-1">
                        <Key className="w-3.5 h-3.5 text-stone-400" />
                        <span className="text-xs text-stone-500 font-mono">
                          {secretVisible ? ep.secret : '••••••••••••••••••••••••'}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleSecret(ep.id)}
                          className="p-1 text-stone-400 hover:text-stone-600"
                        >
                          {secretVisible ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleToggle(ep.id, ep.status)}
                      disabled={isToggling}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition shadow-2xs cursor-pointer ${
                        isActive
                          ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>
                        {isToggling ? 'Đang xử lý...' : isActive ? 'Disable' : 'Enable'}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
