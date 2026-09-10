import { FormEvent, useEffect, useMemo, useState } from 'react';
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

const nav = ['Tổng quan', 'Kết nối ACB', 'Giao dịch', 'Webhooks', 'Phân phối', 'Polling', 'Chẩn đoán', 'Audit'];

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const text = await response.text();
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      message = JSON.parse(text).error ?? message;
    } catch {
      if (text.trim()) message = text.trim();
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
};

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

export default function App() {
  const [active, setActive] = useState('Tổng quan');
  const [status, setStatus] = useState<Status | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [pollRuns, setPollRuns] = useState<PollRun[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [csrf, setCsrf] = useState('');
  const [accountMasked, setAccountMasked] = useState('');
  const [endpointName, setEndpointName] = useState('');
  const [endpointURL, setEndpointURL] = useState('');
  const [activeAttempt, setActiveAttempt] = useState<{ id: string; screenURL: string } | null>(null);
  const [authState, setAuthState] = useState<string>('');
  const [newEndpointSecret, setNewEndpointSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const connected = connection?.configured === true;
  const acbState = connection?.connection?.state ?? status?.acb?.state ?? 'UNCONFIGURED';

  const load = async () => {
    const [statusRes, connRes, epsRes, csrfRes] = await Promise.allSettled([
      api<Status>('/status'),
      api<Connection>('/connection'),
      api<{ items: Endpoint[] }>('/webhooks'),
      api<{ token: string }>('/csrf'),
    ]);

    if (statusRes.status === 'fulfilled') setStatus(statusRes.value);
    if (connRes.status === 'fulfilled') setConnection(connRes.value);
    if (epsRes.status === 'fulfilled') setEndpoints(epsRes.value.items);
    if (csrfRes.status === 'fulfilled') setCsrf(csrfRes.value.token);

    // Fetch tab-specific data
    if (active === 'Giao dịch') {
      try {
        const txRes = await api<{ items: Transaction[] }>('/transactions');
        setTransactions(txRes.items);
      } catch {
        // ignore
      }
    } else if (active === 'Phân phối') {
      try {
        const delRes = await api<{ items: Delivery[] }>('/deliveries');
        setDeliveries(delRes.items);
      } catch {
        // ignore
      }
    } else if (active === 'Polling') {
      try {
        const pRes = await api<{ items: PollRun[] }>('/poll-runs');
        setPollRuns(pRes.items);
      } catch {
        // ignore
      }
    } else if (active === 'Audit') {
      try {
        const aRes = await api<{ items: AuditLog[] }>('/audit');
        setAuditLogs(aRes.items);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!activeAttempt) return;
    const check = async () => {
      try {
        const result = await api<{ status: string }>(`/connection/auth/${activeAttempt.id}/status`);
        setAuthState(result.status);
        if (result.status === 'MONITORING') {
          setActiveAttempt(null);
          setNotice({ kind: 'ok', text: 'ACB đã xác thực. Hệ thống đang bắt đầu theo dõi giao dịch.' });
          await load();
        }
      } catch (error) {
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Không thể kiểm tra trạng thái đăng nhập ACB.' });
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 3_000);
    return () => window.clearInterval(timer);
  }, [activeAttempt]);

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
      setNotice({ kind: 'error', text: String(error) });
    }
  };

  const startAuth = async () => {
    try {
      const res = (await mutate('/connection/auth/start')) as { attemptId: string; screenUrl: string };
      setActiveAttempt({ id: res.attemptId, screenURL: res.screenUrl });
      setNotice({ kind: 'ok', text: 'Đã mở trình duyệt ACB trên server. Nhập trực tiếp mật khẩu, OTP và CAPTCHA trong trang ACB bên dưới.' });
    } catch (error) {
      setNotice({ kind: 'error', text: String(error) });
    }
  };

  const cancelAuth = async () => {
    if (!activeAttempt) return;
    try {
      await mutate('/connection/auth/cancel', { attemptId: activeAttempt.id });
      setActiveAttempt(null);
      setNotice({ kind: 'ok', text: 'Đã hủy phiên đăng nhập ACB.' });
    } catch (error) {
      setNotice({ kind: 'error', text: String(error) });
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
      setNotice({ kind: 'error', text: String(error) });
    }
  };

  const perform = async (path: string) => {
    try {
      await mutate(path);
      setNotice({ kind: 'ok', text: 'Đã ghi nhận thao tác.' });
    } catch (error) {
      setNotice({ kind: 'error', text: String(error) });
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
                <dd>{connection?.connection?.accountMasked}</dd>
                <dt>Trạng thái</dt>
                <dd>{connection?.connection?.state}</dd>
                <dt>Generation</dt>
                <dd>{connection?.connection?.generation}</dd>
              </dl>

              <div className="actions" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <button onClick={() => void perform('/connection/pause')}>
                  <CirclePause size={17} /> Pause
                </button>
                <button onClick={() => void perform('/connection/resume')}>
                  <RefreshCw size={17} /> Resume
                </button>
                <button onClick={() => void perform('/connection/sync')}>
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

                {acbState === 'MONITORING' ? (
                  <div style={{ color: '#52b788', fontSize: '0.9rem' }}>
                    <CheckCircle2 size={16} style={{ display: 'inline', marginRight: 6 }} />
                    Phiên ACB đang hoạt động bình thường. Bạn có thể xác thực lại bất cứ lúc nào nếu cần gia hạn phiên.
                    <div style={{ marginTop: 12 }}>
                      <button onClick={startAuth} style={{ padding: '6px 12px', borderRadius: 6 }}>
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
          <h2>Giao dịch</h2>
          <p className="muted">Danh sách giao dịch tài khoản ACB được nhận diện và chuẩn hóa gần realtime.</p>

          <div style={{ marginTop: 18, overflowX: 'auto' }}>
            {transactions.length === 0 ? (
              <p className="empty">Chưa có giao dịch nào được ghi nhận. Khi ACB có giao dịch tiền vào/ra, dữ liệu sẽ hiển thị tại đây.</p>
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
                  {transactions.map((t) => (
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
                    <th style={{ padding: '10px 8px' }}>Thời gian</th>
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
                      <td style={{ padding: '10px 8px' }}>{d.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
                    <th style={{ padding: '10px 8px' }}>Thời gian</th>
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
                        >
                          {p.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px' }}>{p.classifier || '-'}</td>
                      <td style={{ padding: '10px 8px' }}>{p.httpStatus || '-'}</td>
                      <td style={{ padding: '10px 8px' }}>{p.rowsSeen}</td>
                      <td style={{ padding: '10px 8px' }}>{p.startedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
                    <th style={{ padding: '10px 8px' }}>Thời gian</th>
                    <th style={{ padding: '10px 8px' }}>Tác nhân</th>
                    <th style={{ padding: '10px 8px' }}>Vai trò</th>
                    <th style={{ padding: '10px 8px' }}>Hành động</th>
                    <th style={{ padding: '10px 8px' }}>Mục tiêu</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((a) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid #162438' }}>
                      <td style={{ padding: '10px 8px' }}>{a.createdAt}</td>
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
        </section>
      );
    }

    return null;
  }, [active, connected, connection, acbState, endpoints, transactions, deliveries, pollRuns, auditLogs, newEndpointSecret, activeAttempt, accountMasked, endpointName, endpointURL, status]);

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
