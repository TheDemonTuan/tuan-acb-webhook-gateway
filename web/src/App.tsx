import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  CirclePause,
  Database,
  KeyRound,
  ListRestart,
  Lock,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Webhook,
  XCircle,
} from 'lucide-react';
import { api, isTerminalAuthError } from './api';

type Status = {
  service: string;
  version: string;
  uptimeSeconds: number;
  acb: { state: string; coverage: string; accountMasked?: string; generation?: number };
  storage: { status: string };
  webhooks: { pending: number; deadLetter: number };
};

type Connection = {
  configured: boolean;
  connection?: { id: string; state: string; accountMasked: string; generation: number; updatedAt: string };
};

type Endpoint = {
  id: string;
  name: string;
  url: string;
  status: string;
  revision: number;
  createdAt: string;
  secret?: string;
};

type Transaction = {
  id: string;
  semanticKey: string;
  transactionDate: string;
  effectiveDate: string;
  debit: number;
  credit: number;
  balance?: number;
  description: string;
  firstSeenAt: string;
};

type Delivery = {
  id: string;
  eventId: string;
  endpointId: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
};

type PollRun = {
  id: string;
  connectionId: string;
  generation: number;
  status: string;
  classifier?: string;
  httpStatus?: number;
  pages: number;
  rowsSeen: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
};

type AuditLog = {
  id: string;
  subject: string;
  role: string;
  action: string;
  target: string;
  createdAt: string;
};

type PageResponse<T> = { items: T[]; nextCursor?: string };

const nav = ['Tổng quan', 'Kết nối ACB', 'Giao dịch', 'Webhooks', 'Phân phối', 'Polling', 'Chẩn đoán', 'Audit'];

const errorMessage = (error: unknown, fallback = 'Yêu cầu không thành công. Vui lòng thử lại.'): string =>
  error instanceof Error ? error.message : fallback;

function Card({ title, value, detail, icon: Icon }: { title: string; value: string; detail: string; icon: typeof Database }) {
  return (
    <section className="card">
      <div className="card-heading">
        <span>{title}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const formatVietnamTime = (value?: string): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: VIETNAM_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'medium',
    hourCycle: 'h23',
  }).format(date);
};

const vietnamDateKey = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

function transactionDateKey(dateStr: string): string | null {
  if (!dateStr) return null;
  const match = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? null : vietnamDateKey(date);
}

const shiftDateKey = (key: string, days: number): string => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export default function App() {
  const [active, setActive] = useState('Tổng quan');
  const [status, setStatus] = useState<Status | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [pollRuns, setPollRuns] = useState<PollRun[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [nextCursors, setNextCursors] = useState<Record<string, string | undefined>>({});
  const [pageLoading, setPageLoading] = useState(false);

  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | '7days' | '30days' | 'all' | 'custom'>('today');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'credit' | 'debit'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredTransactions = useMemo(() => {
    const today = vietnamDateKey();
    const yesterday = shiftDateKey(today, -1);
    const sevenDaysStart = shiftDateKey(today, -7);
    const thirtyDaysStart = shiftDateKey(today, -30);

    return transactions.filter((t) => {
      const dateKey = transactionDateKey(t.transactionDate);
      if (dateKey) {
        if (dateFilter === 'today' && dateKey !== today) return false;
        if (dateFilter === 'yesterday' && dateKey !== yesterday) return false;
        if (dateFilter === '7days' && (dateKey < sevenDaysStart || dateKey > today)) return false;
        if (dateFilter === '30days' && (dateKey < thirtyDaysStart || dateKey > today)) return false;
        if (dateFilter === 'custom') {
          if (customStartDate && dateKey < customStartDate) return false;
          if (customEndDate && dateKey > customEndDate) return false;
        }
      } else if (dateFilter !== 'all') {
        return false;
      }
      if (typeFilter === 'credit' && t.credit <= 0) return false;
      if (typeFilter === 'debit' && t.debit <= 0) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const values = [t.semanticKey, t.description || '', t.transactionDate, `${t.credit} ${t.debit}`];
        if (!values.some((value) => value.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [transactions, dateFilter, customStartDate, customEndDate, typeFilter, searchQuery]);
  const { totalCredit, totalDebit } = useMemo(() => {
    let credit = 0;
    let debit = 0;
    for (const t of filteredTransactions) {
      credit += t.credit || 0;
      debit += t.debit || 0;
    }
    return { totalCredit: credit, totalDebit: debit };
  }, [filteredTransactions]);

  const [csrf, setCsrf] = useState('');
  const [accountMasked, setAccountMasked] = useState('');
  const [endpointName, setEndpointName] = useState('');
  const [endpointURL, setEndpointURL] = useState('');
  const [activeAttempt, setActiveAttempt] = useState<{ id: string; screenURL: string } | null>(null);
  const [authState, setAuthState] = useState<string>('');
  const [authRequestPending, setAuthRequestPending] = useState(false);
  const authOperation = useRef(0);
  const [newEndpointSecret, setNewEndpointSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const loadSeq = useRef(0);
  const expandedPages = useRef(new Set<string>());

  const acbState = connection?.connection?.state ?? status?.acb?.state ?? 'UNCONFIGURED';
  const connected =
    connection?.configured ??
    (Boolean(status?.acb?.accountMasked) || (status?.acb?.state !== undefined && status.acb.state !== 'UNCONFIGURED'));

  const isMonitoring = acbState === 'MONITORING';
  const hasActiveAuth = activeAttempt !== null || authRequestPending;
  const syncDisabled = !isMonitoring || hasActiveAuth || syncPending || actionPending;

  const load = async () => {
    const seq = ++loadSeq.current;
    const [statusRes, connRes, epsRes, csrfRes] = await Promise.allSettled([
      api<Status>('/status'),
      api<Connection>('/connection'),
      api<{ items: Endpoint[] }>('/webhooks'),
      api<{ token: string }>('/csrf'),
    ]);

    if (seq !== loadSeq.current) return;

    if (statusRes.status === 'fulfilled') setStatus(statusRes.value);
    if (connRes.status === 'fulfilled') setConnection(connRes.value);
    if (epsRes.status === 'fulfilled') setEndpoints(epsRes.value.items);
    if (csrfRes.status === 'fulfilled') setCsrf(csrfRes.value.token);

    // Fetch tab-specific data
    if (active === 'Giao dịch' || active === 'Tổng quan') {
      try {
        const txRes = await api<PageResponse<Transaction>>('/transactions?limit=50');
        if (seq === loadSeq.current) {
          setTransactions((current) => current.length > 50
            ? [...txRes.items, ...current.filter((item) => !txRes.items.some((fresh) => fresh.id === item.id))]
            : txRes.items);
          if (!expandedPages.current.has('transactions')) setNextCursors((current) => ({ ...current, transactions: txRes.nextCursor }));
        }
      } catch {
        // ignore
      }
    } else if (active === 'Phân phối') {
      try {
        const delRes = await api<PageResponse<Delivery>>('/deliveries?limit=50');
        if (seq === loadSeq.current) {
          setDeliveries((current) => current.length > 50
            ? [...delRes.items, ...current.filter((item) => !delRes.items.some((fresh) => fresh.id === item.id))]
            : delRes.items);
          if (!expandedPages.current.has('deliveries')) setNextCursors((current) => ({ ...current, deliveries: delRes.nextCursor }));
        }
      } catch {
        // ignore
      }
    } else if (active === 'Polling') {
      try {
        const pRes = await api<PageResponse<PollRun>>('/poll-runs?limit=50');
        if (seq === loadSeq.current) {
          setPollRuns((current) => current.length > 50
            ? [...pRes.items, ...current.filter((item) => !pRes.items.some((fresh) => fresh.id === item.id))]
            : pRes.items);
          if (!expandedPages.current.has('polls')) setNextCursors((current) => ({ ...current, polls: pRes.nextCursor }));
        }
      } catch {
        // ignore
      }
    } else if (active === 'Audit') {
      try {
        const aRes = await api<PageResponse<AuditLog>>('/audit?limit=50');
        if (seq === loadSeq.current) {
          setAuditLogs((current) => current.length > 50
            ? [...aRes.items, ...current.filter((item) => !aRes.items.some((fresh) => fresh.id === item.id))]
            : aRes.items);
          if (!expandedPages.current.has('audit')) setNextCursors((current) => ({ ...current, audit: aRes.nextCursor }));
        }
      } catch {
        // ignore
      }
    }
  };

  const loadMore = async <T,>(
    key: string,
    path: string,
    items: T[],
    setItems: (items: T[]) => void,
  ) => {
    const cursor = nextCursors[key];
    if (!cursor || pageLoading) return;
    setPageLoading(true);
    try {
      const page = await api<PageResponse<T>>(`${path}?limit=50&cursor=${encodeURIComponent(cursor)}`);
      const seen = new Set(items.map((item) => (item as { id: string }).id));
      setItems([...items, ...page.items.filter((item) => !seen.has((item as { id: string }).id))]);
      expandedPages.current.add(key);
      setNextCursors((current) => ({ ...current, [key]: page.nextCursor }));
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!activeAttempt) return;
    let cancelled = false;
    let checking = false;
    let timer: number | undefined;
    const check = async () => {
      if (checking || cancelled) return;
      checking = true;
      try {
        const result = await api<{ status: string; error?: string }>(`/connection/auth/${activeAttempt.id}/status`);
        if (cancelled) return;
        setAuthState(result.status);
        if (result.status === 'MONITORING' || result.status === 'VERIFIED') {
          cancelled = true;
          setActiveAttempt(null);
          setAuthState('');
          setNotice({ kind: 'ok', text: 'ACB đã xác thực. Hệ thống đang bắt đầu theo dõi giao dịch.' });
          await load();
          return;
        }
        if (result.status === 'FAILED' || result.status === 'EXPIRED' || result.status === 'CANCELLED') {
          cancelled = true;
          setActiveAttempt(null);
          setAuthState('');
          if (result.status === 'CANCELLED') {
            setNotice({ kind: 'ok', text: 'Phiên đăng nhập ACB đã được hủy.' });
          } else {
            setNotice({ kind: 'error', text: result.error ?? 'Phiên đăng nhập ACB đã kết thúc. Vui lòng mở phiên mới.' });
          }
          await load();
          return;
        }
      } catch (error) {
        if (cancelled) return;
        if (isTerminalAuthError(error)) {
          cancelled = true;
          setActiveAttempt(null);
          setAuthState('');
          setNotice({
            kind: 'error',
            text: errorMessage(
              error,
              error.code === 'AUTH_SESSION_SUPERSEDED'
                ? 'Phiên đăng nhập ACB đã được thay thế. Vui lòng mở phiên mới.'
                : 'Không tìm thấy phiên đăng nhập ACB. Vui lòng mở phiên mới.'
            ),
          });
          await load();
          return;
        }
        setNotice({ kind: 'error', text: errorMessage(error, 'Không thể kiểm tra trạng thái đăng nhập ACB.') });
      } finally {
        checking = false;
        if (!cancelled) timer = window.setTimeout(() => void check(), 3_000);
      }
    };
    void check();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeAttempt?.id]);

  const mutate = async (path: string, body?: unknown) => {
    const res = await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body ? JSON.stringify(body) : '{}',
    });
    await load();
    return res;
  };

  const configure = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await mutate('/connection/configure', { accountMasked });
      setNotice({ kind: 'ok', text: 'Đã lưu kết nối.' });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    }
  };

  const startAuth = async () => {
    if (authRequestPending || activeAttempt) return;
    const operation = ++authOperation.current;
    setAuthRequestPending(true);
    try {
      setAuthState('STARTING');
      setNotice({ kind: 'ok', text: 'Đang khởi động trình duyệt ACB…' });
      const res = (await mutate('/connection/auth/start')) as { attemptId: string; screenUrl: string; status: string };
      if (authOperation.current !== operation) return;
      setActiveAttempt({ id: res.attemptId, screenURL: res.screenUrl });
      setAuthState(res.status);
      setNotice({ kind: 'ok', text: 'Trình duyệt ACB đã sẵn sàng. Nhập trực tiếp mật khẩu, OTP và CAPTCHA trong trang bên dưới.' });
    } catch (error) {
      if (authOperation.current !== operation) return;
      if (isTerminalAuthError(error)) {
        setActiveAttempt(null);
        setAuthState('');
      } else {
        setAuthState('FAILED');
      }
      setNotice({ kind: 'error', text: errorMessage(error, 'Không thể khởi động trình duyệt ACB.') });
      await load();
    } finally {
      if (authOperation.current === operation) setAuthRequestPending(false);
    }
  };

  const cancelAuth = async () => {
    if (!activeAttempt || authRequestPending) return;
    const operation = ++authOperation.current;
    const attemptID = activeAttempt.id;
    setAuthRequestPending(true);
    try {
      await mutate('/connection/auth/cancel', { attemptId: attemptID });
      if (authOperation.current !== operation) return;
      setActiveAttempt(null);
      setAuthState('CANCELLED');
      setNotice({ kind: 'ok', text: 'Đã hủy phiên đăng nhập ACB.' });
    } catch (error) {
      if (authOperation.current === operation) {
        if (isTerminalAuthError(error)) {
          setActiveAttempt(null);
          setAuthState('');
        }
        setNotice({ kind: 'error', text: errorMessage(error) });
        await load();
      }
    } finally {
      if (authOperation.current === operation) setAuthRequestPending(false);
    }
  };

  const createEndpoint = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const res = (await mutate('/webhooks', { name: endpointName, url: endpointURL })) as Endpoint;
      setEndpointName('');
      setEndpointURL('');
      if (res.secret) {
        setNewEndpointSecret(res.secret);
      }
      setNotice({ kind: 'ok', text: 'Đã tạo endpoint ở trạng thái DISABLED.' });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    }
  };

  const perform = async (path: string) => {
    if (actionPending) return;
    setActionPending(true);
    try {
      await mutate(path);
      setNotice({ kind: 'ok', text: 'Đã ghi nhận thao tác.' });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      setActionPending(false);
    }
  };

  const triggerSync = async () => {
    if (syncDisabled) return;
    setSyncPending(true);
    try {
      const res = (await mutate('/connection/sync')) as { status?: string };
      if (res?.status === 'ACCEPTED') {
        setNotice({ kind: 'ok', text: 'Đã tiếp nhận yêu cầu đồng bộ ACB.' });
      } else {
        setNotice({ kind: 'ok', text: 'Đã tiếp nhận yêu cầu đồng bộ.' });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      setSyncPending(false);
    }
  };

  const content = useMemo(() => {
    if (active === 'Tổng quan') {
      return (
        <>
          <section className="grid">
            <Card title="Dịch vụ" value={status?.service ?? 'UNREACHABLE'} detail={status?.version ?? '2.0.0-dev'} icon={ShieldCheck} />
            <Card title="Kết nối ACB" value={acbState} detail={connection?.connection?.accountMasked ?? 'Chưa cấu hình'} icon={Radio} />
            <Card title="Cơ sở dữ liệu" value={status?.storage?.status ?? 'UNKNOWN'} detail="SQLite WAL local" icon={Database} />
            <Card
              title="Webhooks"
              value={`${status?.webhooks?.pending ?? 0} chờ`}
              detail={`${status?.webhooks?.deadLetter ?? 0} dead-letter`}
              icon={Webhook}
            />
          </section>

          <section className="panel">
            <h2>Tổng quan hệ thống</h2>
          <p className="muted">Theo dõi trạng thái gần realtime, tự động phát hiện phiên ACB và chuyển tiếp webhook có chữ ký HMAC.</p>

          {acbState === 'AUTH_REQUIRED' && (
            <div className="notice" style={{ marginTop: 18 }}>
              <AlertTriangle size={20} />
              <div>
                <strong>ACB yêu cầu xác thực phiên</strong>
                <p style={{ margin: '4px 0 10px', fontSize: '0.85rem' }}>
                  Phiên đăng nhập ACB chưa có hoặc đã hết hạn. Hãy xác thực để tiếp tục monitor giao dịch.
                </p>
                <button
                  onClick={() => setActive('Kết nối ACB')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    background: '#e09f3e',
                    color: '#111',
                    fontWeight: 700,
                    border: 0,
                  }}
                >
                  Đăng nhập ACB ngay
                </button>
              </div>
            </div>
          )}

          {acbState === 'MONITORING' && (
            <div className="notice ok" style={{ marginTop: 18 }}>
              <CheckCircle2 size={20} />
              <div>
                <strong>ACB đang hoạt động (MONITORING)</strong>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                  Hệ thống đang tự động truy vấn lịch sử giao dịch ACB và gửi webhook khi phát hiện tiền vào.
                </p>
              </div>
            </div>
          )}

          <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div style={{ padding: 16, border: '1px solid #263750', borderRadius: 12, background: '#0a1424' }}>
              <h3 style={{ fontSize: '1rem', margin: '0 0 8px', color: '#7ec4ff' }}>Quy trình đăng nhập ACB</h3>
              <p style={{ fontSize: '0.82rem', color: '#9dabbe', lineHeight: 1.5, margin: 0 }}>
                1. Mở tab <strong>Kết nối ACB</strong>.<br />
                2. Nhập số tài khoản đã che (ví dụ: ***1234).<br />
                3. Bấm <strong>Bắt đầu đăng nhập ACB</strong> để xác thực phiên.<br />
                4. Hệ thống chuyển sang <strong>MONITORING</strong> và tự động phát webhook khi có giao dịch.
              </p>
            </div>
            <div style={{ padding: 16, border: '1px solid #263750', borderRadius: 12, background: '#0a1424' }}>
              <h3 style={{ fontSize: '1rem', margin: '0 0 8px', color: '#7ec4ff' }}>An toàn & Bảo mật</h3>
              <p style={{ fontSize: '0.82rem', color: '#9dabbe', lineHeight: 1.5, margin: 0 }}>
                - Không lưu mật khẩu/OTP ngân hàng.<br />
                - Webhook ký HMAC-SHA256 chuẩn `v1`.<br />
                - Chống replay với Nonce và Timestamp.<br />
                - Ngăn ngừa SSRF đối với mọi endpoint nhận webhook.
              </p>
            </div>
          </div>
        </section>
        </>
      );
    }

    if (active === 'Kết nối ACB') {
      return (
        <section className="panel">
          <h2>Kết nối ACB</h2>
          <p className="muted">Cấu hình tài khoản ACB và xác thực phiên đăng nhập an toàn.</p>

          {!connected ? (
            <form onSubmit={configure} className="form" style={{ marginTop: 18 }}>
              <label>
                Số tài khoản đã che
                <input
                  aria-label="Số tài khoản đã che"
                  value={accountMasked}
                  onChange={(e) => setAccountMasked(e.target.value)}
                  placeholder="***1234"
                  required
                />
              </label>
              <button>
                <KeyRound size={17} /> Lưu kết nối
              </button>
            </form>
          ) : (
            <>
              <dl>
                <dt>Tài khoản</dt>
                <dd>{connection?.connection?.accountMasked ?? status?.acb?.accountMasked ?? 'Chưa cấu hình'}</dd>
                <dt>Trạng thái</dt>
                <dd>{connection?.connection?.state ?? acbState}</dd>
                <dt>Generation</dt>
                <dd>{connection?.connection?.generation ?? status?.acb?.generation ?? 0}</dd>
              </dl>

              <div className="actions" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <button onClick={() => void perform('/connection/pause')} disabled={actionPending}>
                  <CirclePause size={17} /> Pause
                </button>
                <button onClick={() => void perform('/connection/resume')} disabled={actionPending}>
                  <RefreshCw size={17} /> Resume
                </button>
                <button onClick={() => void triggerSync()} disabled={syncDisabled} aria-label="Sync">
                  <ListRestart size={17} /> Sync
                </button>
              </div>

              <div
                style={{
                  marginTop: 24,
                  padding: 18,
                  border: '1px solid #34495e',
                  borderRadius: 12,
                  background: '#0d1b2a',
                }}
              >
                <h3 style={{ margin: '0 0 10px', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Lock size={18} color="#7ec4ff" /> Đăng nhập & Xác thực ACB
                </h3>

                {acbState === 'MONITORING' && !activeAttempt ? (
                  <div style={{ color: '#52b788', fontSize: '0.9rem' }}>
                    <CheckCircle2 size={16} style={{ display: 'inline', marginRight: 6 }} />
                    Phiên ACB đang hoạt động bình thường. Bạn có thể xác thực lại bất cứ lúc nào nếu cần gia hạn phiên.
                    <div style={{ marginTop: 12 }}>
                      <button onClick={startAuth} disabled={authRequestPending || activeAttempt !== null} style={{ padding: '6px 12px', borderRadius: 6 }}>
                        Gia hạn / Đăng nhập lại phiên ACB
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: '#9dabbe' }}>
                      Bắt đầu phiên đăng nhập trên server để xác thực ACB ONE Web và kích hoạt theo dõi lịch sử.
                    </p>

                    {!activeAttempt ? (
                      <button
                        onClick={startAuth}
                        disabled={authRequestPending}
                        style={{
                          padding: '8px 16px',
                          background: '#2b5c8f',
                          color: '#fff',
                          fontWeight: 600,
                          borderRadius: 8,
                          border: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Play size={16} /> Bắt đầu đăng nhập ACB
                      </button>
                    ) : (
                      <div style={{ padding: 14, background: '#112233', borderRadius: 8, border: '1px solid #1e3a5f' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.85rem', color: '#7ec4ff' }}>
                            Đang mở trình duyệt ACB: <strong>{activeAttempt.id}</strong>
                          </span>
                          <button
                            onClick={cancelAuth}
                            disabled={authRequestPending}
                            style={{ padding: '4px 10px', background: '#5c1d1d', color: '#ffaaaa', border: 0, borderRadius: 4, fontSize: '0.8rem' }}
                          >
                            Hủy phiên
                          </button>
                        </div>
                        <p style={{ margin: '12px 0', fontSize: '0.85rem', color: '#9dabbe' }}>
                          Nhập mật khẩu, OTP và CAPTCHA trực tiếp trong trang ACB. Dashboard không nhận hoặc lưu các giá trị này. Trạng thái: <strong>{authState || 'ĐANG KẾT NỐI'}</strong>.
                        </p>
                        <iframe
                          title="Đăng nhập ACB"
                          src={activeAttempt.screenURL}
                          style={{ width: '100%', height: 750, border: '1px solid #263750', borderRadius: 8, background: '#1a202c' }}
                          allow="clipboard-read; clipboard-write; fullscreen"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      );
    }

    if (active === 'Giao dịch') {
      return (
        <section className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2>Giao dịch</h2>
              <p className="muted">Danh sách giao dịch tài khoản ACB được nhận diện và chuẩn hóa realtime.</p>
            </div>
            <button onClick={() => void triggerSync()} disabled={syncDisabled} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={15} className={syncPending ? 'spin' : ''} /> Quét giao dịch mới
            </button>
          </div>

          {/* Quick Date Filters */}
          <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', color: '#7ec4ff', fontWeight: 600, marginRight: 4 }}>Thời gian:</span>
            {[
              { id: 'today', label: 'Hôm nay (Mặc định)' },
              { id: 'yesterday', label: 'Hôm qua' },
              { id: '7days', label: '7 ngày qua' },
              { id: '30days', label: '30 ngày qua' },
              { id: 'all', label: 'Tất cả' },
              { id: 'custom', label: 'Tùy chọn khoảng ngày...' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDateFilter(tab.id as any)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  border: dateFilter === tab.id ? '1px solid #5aaae8' : '1px solid #263750',
                  background: dateFilter === tab.id ? '#18375b' : '#0e192b',
                  color: dateFilter === tab.id ? '#ffffff' : '#8da1bd',
                  cursor: 'pointer',
                  fontWeight: dateFilter === tab.id ? 700 : 400,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Custom Date Range Picker */}
          {dateFilter === 'custom' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', background: '#112239', borderRadius: 10, border: '1px solid #263e60' }}>
              <label style={{ fontSize: '0.8rem', color: '#a7b9d2', display: 'flex', alignItems: 'center', gap: 6 }}>
                Từ ngày:
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #334d70', background: '#09111f', color: '#e8edf6', fontSize: '0.8rem' }}
                />
              </label>
              <label style={{ fontSize: '0.8rem', color: '#a7b9d2', display: 'flex', alignItems: 'center', gap: 6 }}>
                Đến ngày:
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #334d70', background: '#09111f', color: '#e8edf6', fontSize: '0.8rem' }}
                />
              </label>
              {(customStartDate || customEndDate) && (
                <button
                  type="button"
                  onClick={() => { setCustomStartDate(''); setCustomEndDate(''); }}
                  style={{ fontSize: '0.75rem', padding: '4px 8px', background: 'transparent', border: '1px solid #445d7e', borderRadius: 6, color: '#9dabbe' }}
                >
                  Xóa lọc ngày
                </button>
              )}
            </div>
          )}

          {/* Type Filter & Search Bar */}
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '0.82rem', color: '#7ec4ff', fontWeight: 600, marginRight: 4 }}>Loại:</span>
              {[
                { id: 'all', label: 'Tất cả' },
                { id: 'credit', label: 'Tiền vào (+)' },
                { id: 'debit', label: 'Tiền ra (-)' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTypeFilter(t.id as any)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    border: typeFilter === t.id ? '1px solid #5aaae8' : '1px solid #263750',
                    background: typeFilter === t.id ? '#18375b' : '#0e192b',
                    color: typeFilter === t.id ? '#ffffff' : '#8da1bd',
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="text"
                placeholder="Tìm theo nội dung, số GD, số tiền..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid #263750',
                  background: '#09111f',
                  color: '#e8edf6',
                  fontSize: '0.82rem',
                  minWidth: 260,
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #334d70', background: 'transparent', color: '#9dabbe', fontSize: '0.75rem' }}
                >
                  Xóa
                </button>
              )}
            </div>
          </div>

          {/* Summary Stats Cards */}
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div style={{ padding: '10px 14px', background: '#101c30', borderRadius: 10, border: '1px solid #1f3350' }}>
              <div style={{ fontSize: '0.72rem', color: '#7ec4ff', fontWeight: 600 }}>GIAO DỊCH HIỂN THỊ</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: 4 }}>
                {filteredTransactions.length} <span style={{ fontSize: '0.8rem', color: '#8da1bd', fontWeight: 400 }}>/ {transactions.length} tổng số</span>
              </div>
            </div>
            <div style={{ padding: '10px 14px', background: '#101c30', borderRadius: 10, border: '1px solid #1f3350' }}>
              <div style={{ fontSize: '0.72rem', color: '#52b788', fontWeight: 600 }}>TỔNG TIỀN VÀO</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: 4, color: '#52b788' }}>
                +{totalCredit.toLocaleString('vi-VN')} <span style={{ fontSize: '0.75rem' }}>VND</span>
              </div>
            </div>
            <div style={{ padding: '10px 14px', background: '#101c30', borderRadius: 10, border: '1px solid #1f3350' }}>
              <div style={{ fontSize: '0.72rem', color: '#e63946', fontWeight: 600 }}>TỔNG TIỀN RA</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: 4, color: '#e63946' }}>
                -{totalDebit.toLocaleString('vi-VN')} <span style={{ fontSize: '0.75rem' }}>VND</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18, overflowX: 'auto' }}>
            {filteredTransactions.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', background: '#09111f', borderRadius: 12, border: '1px dashed #263750', marginTop: 12 }}>
                <p style={{ color: '#8da1bd', fontSize: '0.9rem', margin: 0 }}>
                  {dateFilter === 'today'
                    ? 'Hôm nay chưa có giao dịch mới nào được ghi nhận.'
                    : 'Không tìm thấy giao dịch nào phù hợp với bộ lọc hiện tại.'}
                </p>
                {dateFilter === 'today' && transactions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDateFilter('all')}
                    style={{ marginTop: 12, padding: '6px 14px', borderRadius: 8, background: '#18375b', border: '1px solid #5aaae8', color: '#fff', fontSize: '0.82rem' }}
                  >
                    Xem tất cả {transactions.length} giao dịch gần đây
                  </button>
                )}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #263750', textAlign: 'left', color: '#7ec4ff' }}>
                    <th style={{ padding: '10px 8px' }}>Số GD</th>
                    <th style={{ padding: '10px 8px' }}>Ngày GD</th>
                    <th style={{ padding: '10px 8px' }}>Ghi có (VND)</th>
                    <th style={{ padding: '10px 8px' }}>Ghi nợ (VND)</th>
                    <th style={{ padding: '10px 8px' }}>Số dư (VND)</th>
                    <th style={{ padding: '10px 8px' }}>Nội dung</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #162438' }}>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{t.semanticKey.replace('ACB:', '')}</td>
                      <td style={{ padding: '10px 8px' }}>{t.transactionDate}</td>
                      <td style={{ padding: '10px 8px', color: t.credit > 0 ? '#52b788' : 'inherit', fontWeight: t.credit > 0 ? 700 : 400 }}>
                        {t.credit > 0 ? `+${t.credit.toLocaleString('vi-VN')}` : '-'}
                      </td>
                      <td style={{ padding: '10px 8px', color: t.debit > 0 ? '#e63946' : 'inherit' }}>
                        {t.debit > 0 ? `-${t.debit.toLocaleString('vi-VN')}` : '-'}
                      </td>
                      <td style={{ padding: '10px 8px' }}>{t.balance != null ? t.balance.toLocaleString('vi-VN') : '-'}</td>
                      <td style={{ padding: '10px 8px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.description || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {nextCursors.transactions && (
            <button disabled={pageLoading} onClick={() => void loadMore('transactions', '/transactions', transactions, setTransactions)}>
              {pageLoading ? 'Đang tải…' : 'Tải thêm giao dịch'}
            </button>
          )}
        </section>
      );
    }

    if (active === 'Webhooks') {
      return (
        <section className="panel">
          <h2>Webhook endpoints</h2>
          <p className="muted">Phát sự kiện có chữ ký HMAC tới ứng dụng ngoài (Messenger, ERP, Backend) khi có tiền vào.</p>

          {newEndpointSecret && (
            <div
              style={{
                margin: '18px 0',
                padding: 14,
                border: '1px solid #2d6a4f',
                borderRadius: 8,
                background: '#0e2a1e',
                color: '#b8f5d4',
              }}
            >
              <strong>Secret ký HMAC (chỉ hiện một lần):</strong>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: 'monospace',
                  padding: 8,
                  background: '#061710',
                  borderRadius: 4,
                  wordBreak: 'break-all',
                }}
              >
                {newEndpointSecret}
              </div>
              <button
                onClick={() => setNewEndpointSecret(null)}
                style={{ marginTop: 8, padding: '4px 10px', fontSize: '0.8rem', background: '#1b4332', color: '#fff', border: 0, borderRadius: 4 }}
              >
                Đã lưu secret
              </button>
            </div>
          )}

          <form onSubmit={createEndpoint} className="form" style={{ marginTop: 18 }}>
            <label>
              Tên endpoint
              <input aria-label="Tên endpoint" value={endpointName} onChange={(e) => setEndpointName(e.target.value)} placeholder="Messenger Webhook" required />
            </label>
            <label>
              HTTPS URL
              <input
                aria-label="HTTPS URL"
                type="url"
                value={endpointURL}
                onChange={(e) => setEndpointURL(e.target.value)}
                placeholder="https://example.com/api/webhook"
                required
              />
            </label>
            <button>
              <Webhook size={17} /> Tạo endpoint
            </button>
          </form>

          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: '1rem', margin: '0 0 12px' }}>Danh sách endpoints</h3>
            {endpoints.length === 0 ? (
              <p className="empty">Chưa có endpoint nào được cấu hình.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {endpoints.map((ep) => (
                  <div
                    key={ep.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      border: '1px solid #263750',
                      borderRadius: 8,
                      background: '#0a1424',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.95rem' }}>{ep.name}</strong>
                      <div style={{ fontSize: '0.8rem', color: '#8da1bd', fontFamily: 'monospace', marginTop: 2 }}>{ep.url}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: ep.status === 'ACTIVE' ? '#1b4332' : '#333',
                          color: ep.status === 'ACTIVE' ? '#74c69d' : '#bbb',
                        }}
                      >
                        {ep.status}
                      </span>
                      {ep.status === 'ACTIVE' ? (
                        <button
                          onClick={() => void perform(`/webhooks/${ep.id}/disable`)}
                          style={{ padding: '4px 10px', fontSize: '0.8rem', borderRadius: 4, background: '#442222', color: '#ffaaaa', border: 0 }}
                        >
                          Disable
                        </button>
                      ) : (
                        <button
                          onClick={() => void perform(`/webhooks/${ep.id}/enable`)}
                          style={{ padding: '4px 10px', fontSize: '0.8rem', borderRadius: 4, background: '#1b4332', color: '#74c69d', border: 0 }}
                        >
                          Enable
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      );
    }

    if (active === 'Phân phối') {
      return (
        <section className="panel">
          <h2>Phân phối Webhook</h2>
          <p className="muted">Nhật ký các lần gửi webhook, số lần thử lại (retry) và trạng thái giao nhận bền vững.</p>

          <div style={{ marginTop: 18, overflowX: 'auto' }}>
            {deliveries.length === 0 ? (
              <p className="empty">Chưa có lượt phân phối nào.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #263750', textAlign: 'left', color: '#7ec4ff' }}>
                    <th style={{ padding: '10px 8px' }}>Delivery ID</th>
                    <th style={{ padding: '10px 8px' }}>Event ID</th>
                    <th style={{ padding: '10px 8px' }}>Trạng thái</th>
                    <th style={{ padding: '10px 8px' }}>Số lần thử</th>
                    <th style={{ padding: '10px 8px' }}>Thời gian (UTC+7)</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} style={{ borderBottom: '1px solid #162438' }}>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{d.id}</td>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{d.eventId}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: d.status === 'DELIVERED' ? '#1b4332' : d.status === 'DEAD_LETTER' ? '#5c1d1d' : '#4a3b10',
                            color: d.status === 'DELIVERED' ? '#74c69d' : d.status === 'DEAD_LETTER' ? '#ffaaaa' : '#f9c74f',
                          }}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px' }}>{d.attempts}</td>
                      <td style={{ padding: '10px 8px' }}>{formatVietnamTime(d.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {nextCursors.deliveries && (
            <button disabled={pageLoading} onClick={() => void loadMore('deliveries', '/deliveries', deliveries, setDeliveries)}>
              {pageLoading ? 'Đang tải…' : 'Tải thêm phân phối'}
            </button>
          )}
        </section>
      );
    }

    if (active === 'Polling') {
      return (
        <section className="panel">
          <h2>Chu kỳ Polling</h2>
          <p className="muted">Nhật ký các chu kỳ truy vấn ngân hàng, mã phân loại trang và số dòng giao dịch ghi nhận.</p>

          <div style={{ marginTop: 18, overflowX: 'auto' }}>
            {pollRuns.length === 0 ? (
              <p className="empty">Chưa có chu kỳ poll nào được ghi nhận.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #263750', textAlign: 'left', color: '#7ec4ff' }}>
                    <th style={{ padding: '10px 8px' }}>Poll ID</th>
                    <th style={{ padding: '10px 8px' }}>Trạng thái</th>
                    <th style={{ padding: '10px 8px' }}>Phân loại</th>
                    <th style={{ padding: '10px 8px' }}>HTTP</th>
                    <th style={{ padding: '10px 8px' }}>Dòng thấy</th>
                    <th style={{ padding: '10px 8px' }}>Thời gian (UTC+7)</th>
                  </tr>
                </thead>
                <tbody>
                  {pollRuns.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #162438' }}>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{p.id}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: p.status === 'SUCCEEDED' ? '#1b4332' : p.status === 'AUTH_REQUIRED' ? '#4a3b10' : '#5c1d1d',
                            color: p.status === 'SUCCEEDED' ? '#74c69d' : p.status === 'AUTH_REQUIRED' ? '#f9c74f' : '#ffaaaa',
                          }}
                          title={p.error}
                        >
                          {p.status}
                        </span>
                        {p.error && (
                          <div style={{ fontSize: '0.7rem', color: '#ffaaaa', marginTop: 4, maxWidth: 280, wordBreak: 'break-word' }}>
                            {p.error}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px' }}>{p.classifier || '-'}</td>
                      <td style={{ padding: '10px 8px' }}>{p.httpStatus || '-'}</td>
                      <td style={{ padding: '10px 8px' }}>{p.rowsSeen}</td>
                      <td style={{ padding: '10px 8px' }}>{formatVietnamTime(p.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {nextCursors.polls && (
            <button disabled={pageLoading} onClick={() => void loadMore('polls', '/poll-runs', pollRuns, setPollRuns)}>
              {pageLoading ? 'Đang tải…' : 'Tải thêm lần polling'}
            </button>
          )}
        </section>
      );
    }

    if (active === 'Chẩn đoán') {
      return (
        <section className="panel">
          <h2>Chẩn đoán hệ thống</h2>
          <p className="muted">Tình trạng runtime, bộ nhớ, cơ sở dữ liệu và bảo mật phiên kết nối.</p>

          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            <div style={{ padding: 16, border: '1px solid #263750', borderRadius: 8, background: '#0a1424' }}>
              <div style={{ color: '#7ec4ff', fontSize: '0.85rem' }}>Service Version</div>
              <strong style={{ fontSize: '1.2rem', display: 'block', marginTop: 6 }}>{status?.version ?? '2.0.0-dev'}</strong>
              <div style={{ fontSize: '0.8rem', color: '#8da1bd', marginTop: 4 }}>Uptime: {status?.uptimeSeconds ?? 0}s</div>
            </div>
            <div style={{ padding: 16, border: '1px solid #263750', borderRadius: 8, background: '#0a1424' }}>
              <div style={{ color: '#7ec4ff', fontSize: '0.85rem' }}>Trạng thái Database</div>
              <strong style={{ fontSize: '1.2rem', display: 'block', marginTop: 6 }}>{status?.storage?.status ?? 'READY'}</strong>
              <div style={{ fontSize: '0.8rem', color: '#8da1bd', marginTop: 4 }}>SQLite WAL Mode (synchronous=FULL)</div>
            </div>
            <div style={{ padding: 16, border: '1px solid #263750', borderRadius: 8, background: '#0a1424' }}>
              <div style={{ color: '#7ec4ff', fontSize: '0.85rem' }}>Hàng đợi Webhook</div>
              <strong style={{ fontSize: '1.2rem', display: 'block', marginTop: 6 }}>
                {status?.webhooks?.pending ?? 0} chờ / {status?.webhooks?.deadLetter ?? 0} lỗi
              </strong>
              <div style={{ fontSize: '0.8rem', color: '#8da1bd', marginTop: 4 }}>Durable transactional outbox</div>
            </div>
          </div>
        </section>
      );
    }

    if (active === 'Audit') {
      return (
        <section className="panel">
          <h2>Audit Logs</h2>
          <p className="muted">Nhật ký kiểm tra toàn diện các thao tác quản trị và thay đổi trạng thái phiên.</p>

          <div style={{ marginTop: 18, overflowX: 'auto' }}>
            {auditLogs.length === 0 ? (
              <p className="empty">Chưa có bản ghi audit nào.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #263750', textAlign: 'left', color: '#7ec4ff' }}>
                    <th style={{ padding: '10px 8px' }}>Thời gian (UTC+7)</th>
                    <th style={{ padding: '10px 8px' }}>Tác nhân</th>
                    <th style={{ padding: '10px 8px' }}>Vai trò</th>
                    <th style={{ padding: '10px 8px' }}>Hành động</th>
                    <th style={{ padding: '10px 8px' }}>Mục tiêu</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((a) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid #162438' }}>
                      <td style={{ padding: '10px 8px' }}>{formatVietnamTime(a.createdAt)}</td>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{a.subject}</td>
                      <td style={{ padding: '10px 8px' }}>{a.role}</td>
                      <td style={{ padding: '10px 8px', color: '#7ec4ff' }}>{a.action}</td>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{a.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {nextCursors.audit && (
            <button disabled={pageLoading} onClick={() => void loadMore('audit', '/audit', auditLogs, setAuditLogs)}>
              {pageLoading ? 'Đang tải…' : 'Tải thêm nhật ký'}
            </button>
          )}
        </section>
      );
    }

    return null;
  }, [
    active,
    connected,
    connection,
    acbState,
    endpoints,
    transactions,
    deliveries,
    pollRuns,
    auditLogs,
    newEndpointSecret,
    activeAttempt,
    authState,
    authRequestPending,
    accountMasked,
    endpointName,
    endpointURL,
    status,
    actionPending,
    syncPending,
    syncDisabled,
    nextCursors,
    pageLoading,
  ]);

  return (
    <main className="shell">
      <header>
        <div>
          <span className="eyebrow">NGÂN HÀNG Á CHÂU · ACB ONE WEB</span>
          <h1>TuanBankGateway</h1>
          <p className="muted">Cổng theo dõi giao dịch ACB độc lập và phân phối webhook bảo mật.</p>
        </div>
        <div className="badge">{status?.service ?? 'UNREACHABLE'}</div>
      </header>

      {notice && (
        <aside className={`notice ${notice.kind}`}>
          {notice.kind === 'ok' ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Đóng thông báo">
            ×
          </button>
        </aside>
      )}

      <nav style={{ marginTop: 22 }}>
        {nav.map((item) => (
          <button key={item} className={active === item ? 'selected' : ''} onClick={() => setActive(item)}>
            {item}
          </button>
        ))}
      </nav>

      {content}
    </main>
  );
}
