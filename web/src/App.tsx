import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Mail,
  Play,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  XCircle,
  Clock,
  Database,
  Globe,
  Radio,
  Key,
  Lock,
  Check,
  FileText,
} from 'lucide-react';

interface QueueMetrics {
  pending: number;
  inFlight: number;
  retrying: number;
  delivered: number;
  deadLetter: number;
}

interface GatewayStatus {
  status: string;
  database: string;
  queue: QueueMetrics;
  endpointsCount: number;
  activeEndpointsCount: number;
  uptimeSeconds: number;
  cloudflareAccess: {
    email: string | null;
    authenticated: boolean;
  };
  gmailAuth: {
    hasCredentials: boolean;
    hasToken: boolean;
    clientId?: string | null;
    redirectUri?: string | null;
    emailAddress?: string | null;
    reconnectRequired?: boolean;
  };
  gmailSync: {
    lastHistoryId: string | null;
    watchExpirationAt: string | null;
    updatedAt: string | null;
  };
}

interface BankEvent {
  id: string;
  eventType: string;
  amount: string;
  accountMasked: string;
  description: string | null;
  transactionAt: string;
  status: string;
  createdAt: string;
}

interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  timeoutMs: number;
  keyVersion: string;
  filter: string[] | null;
  createdAt: string;
  updatedAt: string;
}

interface WebhookDelivery {
  id: string;
  eventId: string;
  endpointName: string;
  endpointUrl: string;
  status: 'PENDING' | 'IN_FLIGHT' | 'RETRYING' | 'DELIVERED' | 'DEAD_LETTER';
  attemptCount: number;
  nextAttemptAt: string;
  lastHttpStatus: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'endpoints' | 'gmail' | 'deliveries' | 'security'>('overview');

  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [events, setEvents] = useState<BankEvent[]>([]);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modals & form state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newEpName, setNewEpName] = useState('');
  const [newEpUrl, setNewEpUrl] = useState('');
  const [newEpSecret, setNewEpSecret] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [isSavingGoogleConfig, setIsSavingGoogleConfig] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);

  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3500);
  };

  const apiFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = { ...(options.headers || {}) } as Record<string, string>;
    if (options.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      showToast('Phiên Cloudflare Access đã hết hạn. Hãy đăng nhập lại qua Cloudflare Access.', true);
      throw new Error('Cloudflare Access authentication is required');
    }
    return res;
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [apiFetch]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await apiFetch('/api/events');
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [apiFetch]);

  const loadEndpoints = useCallback(async () => {
    try {
      const res = await apiFetch('/api/endpoints');
      if (res.ok) {
        const data = await res.json();
        setEndpoints(data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [apiFetch]);

  const loadDeliveries = useCallback(async () => {
    try {
      const res = await apiFetch('/api/deliveries');
      if (res.ok) {
        const data = await res.json();
        setDeliveries(data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [apiFetch]);

  // Check for Google OAuth callback redirect parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail_auth') === 'success') {
      showToast('Đăng nhập và cấp quyền Gmail thành công! Token đã được lưu an toàn.');
      window.history.replaceState({}, document.title, window.location.pathname);
      loadStatus();
      setActiveTab('gmail');
    } else if (params.get('gmail_auth') === 'error') {
      const errMsg = params.get('message') || 'Xác thực Google thất bại';
      showToast(`Đăng nhập Gmail thất bại: ${errMsg}`, true);
      window.history.replaceState({}, document.title, window.location.pathname);
      setActiveTab('gmail');
    }
  }, [loadStatus]);

  // Initial load & interval refresh
  useEffect(() => {
    loadStatus();
    loadEvents();
    const timer = setInterval(() => {
      loadStatus();
      if (activeTab === 'overview') loadEvents();
      if (activeTab === 'deliveries') loadDeliveries();
    }, 8000);
    return () => clearInterval(timer);
  }, [loadStatus, loadEvents, loadDeliveries, activeTab]);

  useEffect(() => {
    if (activeTab === 'endpoints') loadEndpoints();
    if (activeTab === 'deliveries') loadDeliveries();
  }, [activeTab, loadEndpoints, loadDeliveries]);

  const generateSecret = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    setNewEpSecret(`whsec_${hex}`);
  };

  const handleAddEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEpName || !newEpUrl || !newEpSecret) {
      showToast('Vui lòng điền đủ Tên, URL và Secret', true);
      return;
    }

    try {
      setIsLoading(true);
      const res = await apiFetch('/api/endpoints', {
        method: 'POST',
        body: JSON.stringify({ name: newEpName, url: newEpUrl, secret: newEpSecret }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Lỗi thêm endpoint', true);
        return;
      }
      showToast('Đăng ký Webhook Endpoint thành công!');
      setIsAddModalOpen(false);
      setNewEpName('');
      setNewEpUrl('');
      setNewEpSecret('');
      loadEndpoints();
    } catch (err: any) {
      showToast(err.message, true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleEndpoint = async (id: string, currentStatus: boolean) => {
    try {
      const res = await apiFetch(`/api/endpoints/${id}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !currentStatus }),
      });
      if (res.ok) {
        showToast('Đã cập nhật trạng thái endpoint');
        loadEndpoints();
      }
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleDeleteEndpoint = async (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa Webhook Endpoint này?')) return;
    try {
      const res = await apiFetch(`/api/endpoints/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Đã xóa endpoint');
        loadEndpoints();
      }
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleTestPing = async (id: string) => {
    showToast('Đang gửi test ping webhook...');
    try {
      const res = await apiFetch(`/api/endpoints/${id}/test`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Test ping thành công! Downstream trả về HTTP ${data.status}`);
      } else {
        showToast(`Test thất bại: ${data.error || 'Không kết nối được'}`, true);
      }
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleSaveGoogleConfig = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!googleClientId.trim() || !googleClientSecret.trim()) {
      showToast('Vui lòng nhập Google Client ID và Client Secret.', true);
      return;
    }
    try {
      setIsSavingGoogleConfig(true);
      const redirectUri = `${window.location.origin}/api/gmail/oauth2callback`;
      const res = await apiFetch('/api/gmail/config', {
        method: 'POST',
        body: JSON.stringify({
          clientId: googleClientId.trim(),
          clientSecret: googleClientSecret.trim(),
          redirectUri,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể lưu Google OAuth client');
      setGoogleClientId('');
      setGoogleClientSecret('');
      showToast('Đã lưu Google OAuth Client. Hãy thêm callback URL hiển thị bên dưới trong Google Cloud.');
      loadStatus();
    } catch (err: any) {
      showToast(err.message, true);
    } finally {
      setIsSavingGoogleConfig(false);
    }
  };

  const handleConnectGmail = () => {
    window.location.assign('/api/gmail/connect');
  };

  const handleDisconnectGmail = async () => {
    if (!window.confirm('Ngắt kết nối Gmail? Đồng bộ email mới sẽ dừng cho tới khi kết nối lại.')) return;
    try {
      const res = await apiFetch('/api/gmail/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || 'Không thể ngắt kết nối Gmail');
      showToast('Đã ngắt kết nối Gmail.');
      loadStatus();
    } catch (err: any) {
      showToast(err.message, true);
    }
  };
  const handleSyncNow = async () => {
    showToast('Đang yêu cầu đồng bộ Gmail...');
    try {
      const res = await apiFetch('/api/gmail/sync-now', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(`Đồng bộ xong! Đã xử lý ${data.processed} email.`);
        loadStatus();
        loadEvents();
      } else {
        showToast(data.error || 'Lỗi đồng bộ', true);
      }
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleRenewWatch = async () => {
    showToast('Đang gia hạn Pub/Sub watch...');
    try {
      const res = await apiFetch('/api/gmail/renew-watch', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(`Gia hạn thành công! Hạn đến: ${new Date(data.expiration).toLocaleString('vi-VN')}`);
        loadStatus();
      } else {
        showToast(data.error || 'Lỗi gia hạn watch', true);
      }
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleReplayDelivery = async (id: string) => {
    try {
      const res = await apiFetch(`/api/deliveries/${id}/replay`, { method: 'POST' });
      if (res.ok) {
        showToast('Đã đưa webhook vào hàng đợi phát lại!');
        loadDeliveries();
      }
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const formatCurrency = (val: string) => {
    const num = parseInt(val, 10);
    return isNaN(num) ? val : num.toLocaleString('vi-VN');
  };

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* TOP NAVBAR */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  Bank Event Gateway
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  ACB • React 19
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Dedicated Cloudflare Tunnel • HMAC Durable Outbox</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex items-center space-x-2 text-xs bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-slate-300 font-medium">{status?.cloudflareAccess.email || 'Cloudflare Access'}</span>
            </div>

          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-1 sm:space-x-4 border-t border-slate-800/60 overflow-x-auto">
          {[
            { id: 'overview', label: 'Tổng quan & Sự kiện', icon: Activity },
            { id: 'endpoints', label: 'Webhook Endpoints', icon: Globe },
            { id: 'gmail', label: 'Cấu hình Gmail Client', icon: Mail, badge: !status?.gmailAuth?.hasToken },
            { id: 'deliveries', label: 'Lịch sử Webhook Outbox', icon: Send },
            { id: 'security', label: 'Bảo mật Cloudflare', icon: Shield },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition flex items-center space-x-2 shrink-0 ${
                  isActive
                    ? 'border-emerald-400 text-emerald-400 bg-emerald-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
                {tab.badge && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>}
              </button>
            );
          })}
        </div>
      </header>

      {/* MAIN BODY CONTENT */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* STAT METRICS CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Database SQLite</span>
                  <Database className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="mt-2 text-xl font-bold text-white flex items-center space-x-2">
                  <span>WAL Mode</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    Khỏe mạnh
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500 font-mono">gateway.db</div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-start">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Durable Outbox</span>
                  <Send className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="mt-2 text-xl font-bold text-white flex items-baseline space-x-2">
                  <span className="text-emerald-400">{status?.queue.delivered ?? 0}</span>
                  <span className="text-xs text-slate-400 font-normal">đã phát</span>
                </div>
                <div className="mt-1 text-xs text-slate-400 flex space-x-2 font-mono">
                  <span>Chờ: <b className="text-amber-400">{status?.queue.pending ?? 0}</b></span>
                  <span>•</span>
                  <span>Lỗi: <b className="text-rose-400">{status?.queue.deadLetter ?? 0}</b></span>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-start">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Gmail Ingestion</span>
                  <Mail className="w-4 h-4 text-amber-400" />
                </div>
                <div className="mt-2 text-xl font-bold">
                  {status?.gmailAuth.hasToken ? (
                    <span className="text-emerald-400 flex items-center space-x-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Đã kết nối</span>
                    </span>
                  ) : (
                    <span className="text-amber-400 flex items-center space-x-1.5">
                      <AlertCircle className="w-4 h-4" />
                      <span>Chưa cấu hình</span>
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-500 font-mono truncate">
                  History: {status?.gmailSync.lastHistoryId || '--'}
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-start">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Active Webhooks</span>
                  <Radio className="w-4 h-4 text-purple-400" />
                </div>
                <div className="mt-2 text-xl font-bold text-purple-300">
                  {status?.activeEndpointsCount ?? 0}
                  <span className="text-xs text-slate-500 font-normal ml-1">destinations</span>
                </div>
                <div className="mt-1 text-xs text-slate-500 flex items-center space-x-1 font-mono">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span>Uptime: {status ? formatUptime(status.uptimeSeconds) : '0s'}</span>
                </div>
              </div>
            </div>

            {/* RECENT TRANSACTIONS TABLE */}
            <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/40">
                <div>
                  <h3 className="font-bold text-white text-sm sm:text-base">Biến động số dư ACB gần đây (Báo Có)</h3>
                  <p className="text-xs text-slate-400">Tiền vào được xác thực SPF/DKIM Google MX, chuẩn hóa và phát Webhook</p>
                </div>
                <button
                  onClick={loadEvents}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition flex items-center space-x-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Làm mới</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950/70 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3">Thời gian GD</th>
                      <th className="px-5 py-3">Số tiền</th>
                      <th className="px-5 py-3">Tài khoản</th>
                      <th className="px-5 py-3">Nội dung chuyển tiền</th>
                      <th className="px-5 py-3">Phân loại</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {events.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-12 text-center text-slate-500 text-sm">
                          Chưa ghi nhận sự kiện biến động số dư nào.
                        </td>
                      </tr>
                    ) : (
                      events.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-800/30 transition">
                          <td className="px-5 py-3.5 text-xs text-slate-400 font-mono">
                            {new Date(e.transactionAt || e.createdAt).toLocaleString('vi-VN')}
                          </td>
                          <td className="px-5 py-3.5 font-bold text-emerald-400 font-mono text-sm">
                            +{formatCurrency(e.amount)} VND
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-slate-300">
                            {e.accountMasked}
                          </td>
                          <td className="px-5 py-3.5 text-xs text-slate-300 max-w-sm truncate" title={e.description || ''}>
                            {e.description || '-'}
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              Báo Có (+)
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: WEBHOOK ENDPOINTS */}
        {activeTab === 'endpoints' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">Quản lý Webhook Destinations</h2>
                <p className="text-xs text-slate-400">
                  Consumer backend (Messenger Bot, ERP, Order Service) sẽ nhận webhook kèm chữ ký HMAC-SHA256
                </p>
              </div>
              <button
                onClick={() => {
                  generateSecret();
                  setIsAddModalOpen(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 py-2 rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center space-x-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Đăng ký Webhook Mới</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {endpoints.length === 0 ? (
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
                  <Globe className="w-10 h-10 text-slate-600 mx-auto" />
                  <p className="text-sm text-slate-400">Chưa có Webhook Destination nào được đăng ký.</p>
                  <button
                    onClick={() => {
                      generateSecret();
                      setIsAddModalOpen(true);
                    }}
                    className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition"
                  >
                    + Đăng ký ngay
                  </button>
                </div>
              ) : (
                endpoints.map((ep) => (
                  <div
                    key={ep.id}
                    className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-slate-700 transition"
                  >
                    <div className="space-y-1.5 max-w-xl">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white text-sm sm:text-base">{ep.name}</span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            ep.enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-500 border border-slate-700'
                          }`}
                        >
                          {ep.enabled ? 'Đang hoạt động' : 'Tạm dừng'}
                        </span>
                      </div>
                      <div className="font-mono text-xs text-emerald-400 break-all">{ep.url}</div>
                      <div className="text-[11px] text-slate-500">
                        Timeout: {ep.timeoutMs}ms • Key Version: {ep.keyVersion} • Ngày tạo:{' '}
                        {new Date(ep.createdAt).toLocaleDateString('vi-VN')}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        onClick={() => handleTestPing(ep.id)}
                        className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition flex items-center space-x-1.5"
                      >
                        <Play className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Test Ping</span>
                      </button>
                      <button
                        onClick={() => handleToggleEndpoint(ep.id, ep.enabled)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                          ep.enabled
                            ? 'bg-amber-950/30 text-amber-400 border-amber-900/50 hover:bg-amber-900/40'
                            : 'bg-emerald-950/30 text-emerald-400 border-emerald-900/50 hover:bg-emerald-900/40'
                        }`}
                      >
                        {ep.enabled ? 'Tạm dừng' : 'Kích hoạt'}
                      </button>
                      <button
                        onClick={() => handleDeleteEndpoint(ep.id)}
                        className="text-xs bg-rose-950/30 hover:bg-rose-900/50 text-rose-400 border border-rose-900/50 px-2.5 py-1.5 rounded-lg transition"
                        title="Xóa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: GMAIL CONNECTION */}
        {activeTab === 'gmail' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white">Kết nối Gmail</h2>
              <p className="text-xs text-slate-400">Thiết lập OAuth một lần trên dashboard, sau đó đăng nhập Google và cấp quyền.</p>
            </div>
            <div className="max-w-2xl bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <span className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${status?.gmailAuth.hasToken ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Mail className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-white">{status?.gmailAuth.hasToken ? 'Gmail đã kết nối' : 'Gmail chưa kết nối'}</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      {status?.gmailAuth.hasToken
                        ? `Mailbox: ${status.gmailAuth.emailAddress || 'đang xác minh'}`
                        : status?.gmailAuth.hasCredentials
                          ? 'Bấm nút bên dưới để đăng nhập Google và cấp quyền Gmail.'
                          : 'Hãy lưu Google OAuth Client bên dưới trước khi kết nối.'}
                    </p>
                  </div>
                </div>
                {status?.gmailAuth.hasToken ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />}
              </div>

              {!status?.gmailAuth.hasCredentials && (
                <form onSubmit={handleSaveGoogleConfig} className="border border-slate-800 rounded-xl p-4 space-y-3 bg-slate-950/40">
                  <div>
                    <h4 className="font-semibold text-slate-100 text-sm">Thiết lập Google OAuth Client</h4>
                    <p className="text-xs text-slate-400 mt-1">Thông tin này được mã hóa trong database. Callback URL tự lấy từ địa chỉ dashboard bạn đang mở.</p>
                    <ol className="mt-3 space-y-1.5 text-xs text-slate-300 list-decimal list-inside">
                      <li><a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300 underline">Mở Google Cloud Console để bật Gmail API</a>.</li>
                      <li><a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300 underline">Mở OAuth Clients</a> → Create client → chọn <strong>Web application</strong>.</li>
                      <li>Dán Callback URL bên dưới vào <strong>Authorized redirect URIs</strong>, rồi copy Client ID và Client Secret vào form này.</li>
                    </ol>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <input value={googleClientId} onChange={(event) => setGoogleClientId(event.target.value)} placeholder="Google Client ID" className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100" />
                    <input type="password" value={googleClientSecret} onChange={(event) => setGoogleClientSecret(event.target.value)} placeholder="Google Client Secret" className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100" />
                  </div>
                  <div className="rounded-lg bg-slate-950 border border-amber-900/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-amber-300">Authorized redirect URI</p>
                    <code className="mt-1 block text-xs text-slate-100 break-all">{window.location.origin}/api/gmail/oauth2callback</code>
                  </div>
                  <button disabled={isSavingGoogleConfig} className="text-xs px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-60 text-white">{isSavingGoogleConfig ? 'Đang lưu...' : 'Lưu Google OAuth Client'}</button>
                </form>
              )}

              {status?.gmailAuth.hasToken ? (
                <div className="flex flex-wrap gap-3">
                  <button onClick={handleSyncNow} className="text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition inline-flex gap-2 items-center"><RefreshCw className="w-3.5 h-3.5" />�?ng b? ngay</button>
                  <button onClick={handleRenewWatch} className="text-xs px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-200 transition inline-flex gap-2 items-center"><Radio className="w-3.5 h-3.5" />Gia h?n watch</button>
                  <button onClick={handleDisconnectGmail} className="text-xs px-3 py-2 rounded-lg border border-rose-900/60 hover:bg-rose-950/40 text-rose-300 transition inline-flex gap-2 items-center"><Trash2 className="w-3.5 h-3.5" />Ng?t k?t n?i</button>
                </div>
              ) : status?.gmailAuth.hasCredentials ? (
                <button onClick={handleConnectGmail} className="text-sm px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-semibold transition inline-flex gap-2 items-center"><Mail className="w-4 h-4" />Kết nối Gmail</button>
              ) : null}

              <div className="border-t border-slate-800 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div><span className="text-slate-500">Cursor l?ch s?</span><p className="font-mono text-slate-300 mt-1">{status?.gmailSync.lastHistoryId || '--'}</p></div>
                <div><span className="text-slate-500">Watch h?t h?n</span><p className="text-slate-300 mt-1">{status?.gmailSync.watchExpirationAt ? new Date(status.gmailSync.watchExpirationAt).toLocaleString('vi-VN') : '--'}</p></div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'deliveries' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-white">Lịch sử phát Webhook (Durable Outbox)</h2>
                <p className="text-xs text-slate-400">Theo dõi trạng thái gửi, số lần thử lại và nút Gửi lại thủ công (Replay)</p>
              </div>
              <button
                onClick={loadDeliveries}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition flex items-center space-x-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Làm mới</span>
              </button>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950/70 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3">Thời gian</th>
                      <th className="px-5 py-3">Destination</th>
                      <th className="px-5 py-3">Trạng thái</th>
                      <th className="px-5 py-3">HTTP Code</th>
                      <th className="px-5 py-3">Số lần thử</th>
                      <th className="px-5 py-3">Lỗi gần nhất</th>
                      <th className="px-5 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {deliveries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-slate-500 text-sm">
                          Chưa có bản ghi delivery nào trong outbox.
                        </td>
                      </tr>
                    ) : (
                      deliveries.map((d) => (
                        <tr key={d.id} className="hover:bg-slate-800/30 transition text-xs">
                          <td className="px-5 py-3.5 text-slate-400 font-mono">
                            {new Date(d.createdAt).toLocaleString('vi-VN')}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-white">{d.endpointName}</div>
                            <div className="font-mono text-[11px] text-slate-500 truncate max-w-xs">{d.endpointUrl}</div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                d.status === 'DELIVERED'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                  : d.status === 'PENDING'
                                  ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30'
                                  : d.status === 'RETRYING'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              {d.status}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 font-mono">
                            {d.lastHttpStatus ? `HTTP ${d.lastHttpStatus}` : '-'}
                          </td>
                          <td className="px-5 py-3.5 font-mono">{d.attemptCount}</td>
                          <td className="px-5 py-3.5 text-slate-400 max-w-xs truncate text-[11px]" title={d.lastError || ''}>
                            {d.lastError || '-'}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            {d.status === 'DEAD_LETTER' || d.status === 'RETRYING' ? (
                              <button
                                onClick={() => handleReplayDelivery(d.id)}
                                className="text-xs bg-slate-800 hover:bg-slate-700 text-emerald-400 px-2.5 py-1 rounded-lg border border-slate-700 transition"
                              >
                                Gửi lại
                              </button>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: SECURITY & CLOUDFLARE */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white">Bảo mật & Cloudflare Zero Trust</h2>
              <p className="text-xs text-slate-400">Kiến trúc bảo vệ Gateway qua Dedicated Cloudflare Tunnel</p>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="space-y-1">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Cloudflare Access Domain</span>
                <div className="font-mono text-sm font-bold text-emerald-400">https://bank.tuannguyenviet.site</div>
              </div>

              <div className="space-y-1 pt-3 border-t border-slate-800">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Dedicated Tunnel</span>
                <div className="font-mono text-xs text-slate-300">
                  bank-gateway-tunnel (ID: 79a33eef-4eda-4b52-af26-2e0ec047aa70)
                </div>
                <p className="text-[11px] text-slate-500">
                  Tách biệt hoàn toàn khỏi tunnel docker-panel. Ingress trỏ trực tiếp về cổng nội bộ gateway.
                </p>
              </div>

              <div className="space-y-1 pt-3 border-t border-slate-800">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Tài khoản đang đăng nhập</span>
                <div className="font-mono text-sm font-bold text-emerald-400">
                  {status?.cloudflareAccess.email || 'Đang tải phiên Cloudflare Access...'}
                </div>
              </div>

              <div className="space-y-1 pt-3 border-t border-slate-800">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Cloudflare Access JWT</span>
                <p className="text-xs text-slate-300">
                  Cloudflare Access tự xác thực phiên đăng nhập và chuyển assertion JWT tới gateway.
                </p>
                <p className="text-[11px] text-slate-500">
                  Gateway chỉ nhận assertion JWT đã ký và kiểm tra issuer, audience và chữ ký qua Cloudflare JWKS.
                </p>
              </div>

              <div className="space-y-1 pt-3 border-t border-slate-800">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Cloudflare Access AUD</span>
                <div className="font-mono text-xs text-slate-400">
                  546ad6f298f280ba4cc513c26558d7dadc9db37cd37926fc2a6afdcbe626b4e3
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MODAL: ADD ENDPOINT */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-white text-base">Đăng ký Webhook Destination Mới</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddEndpoint} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">Tên gọi Destination</label>
                <input
                  type="text"
                  required
                  value={newEpName}
                  onChange={(e) => setNewEpName(e.target.value)}
                  placeholder="Ví dụ: Facebook Messenger Bot AI / Core Backend"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">URL Webhook (Bắt buộc HTTPS công khai)</label>
                <input
                  type="url"
                  required
                  value={newEpUrl}
                  onChange={(e) => setNewEpUrl(e.target.value)}
                  placeholder="https://api.yourdomain.com/webhook"
                  className="w-full font-mono bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">SSRF Guard sẽ chặn các IP nội bộ, private hoặc loopback.</p>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-300 font-medium">Shared Secret Key (HMAC-SHA256)</label>
                  <button type="button" onClick={generateSecret} className="text-emerald-400 hover:underline text-[11px]">
                    Tạo ngẫu nhiên
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={newEpSecret}
                  onChange={(e) => setNewEpSecret(e.target.value)}
                  placeholder="whsec_..."
                  className="w-full font-mono bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">Secret được mã hóa AES-256-GCM an toàn trước khi lưu DB.</p>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition shadow-lg shadow-emerald-600/20"
                >
                  {isLoading ? 'Đang lưu...' : 'Lưu & Kích hoạt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}`r`n    </div>
  );
}
