import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CirclePause, Database, KeyRound, ListRestart, Radio, RefreshCw, ShieldCheck, Webhook, XCircle } from 'lucide-react';

type Status = { service: string; version: string; uptimeSeconds: number; acb: { state: string; coverage: string; accountMasked?: string }; storage: { status: string }; webhooks: { pending: number; deadLetter: number } };
type Connection = { configured: boolean; connection?: { id: string; state: string; accountMasked: string; generation: number; updatedAt: string } };
type Endpoint = { id: string; name: string; url: string; status: string; revision: number; createdAt: string };

const nav = ['Tổng quan', 'Kết nối ACB', 'Giao dịch', 'Webhooks', 'Phân phối', 'Polling', 'Chẩn đoán', 'Audit'];
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const text = await response.text();
    let message = response.statusText || `HTTP ${response.status}`;
    try { message = JSON.parse(text).error ?? message; } catch { if (text.trim()) message = text.trim(); }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
};

function Card({ title, value, detail, icon: Icon }: { title: string; value: string; detail: string; icon: typeof Database }) {
  return <section className="card"><div className="card-heading"><span>{title}</span><Icon size={18} /></div><strong>{value}</strong><p>{detail}</p></section>;
}

export default function App() {
  const [active, setActive] = useState('Tổng quan');
  const [status, setStatus] = useState<Status | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [csrf, setCsrf] = useState('');
  const [accountMasked, setAccountMasked] = useState('');
  const [endpointName, setEndpointName] = useState('');
  const [endpointURL, setEndpointURL] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const connected = connection?.configured === true;

  const load = async () => {
    const [statusResult, connectionResult, endpointsResult, csrfResult] = await Promise.allSettled([
      api<Status>('/status'), api<Connection>('/connection'), api<{ items: Endpoint[] }>('/webhooks'), api<{ token: string }>('/csrf'),
    ]);
    if (statusResult.status === 'fulfilled') setStatus(statusResult.value);
    if (connectionResult.status === 'fulfilled') setConnection(connectionResult.value);
    if (endpointsResult.status === 'fulfilled') setEndpoints(endpointsResult.value.items);
    if (csrfResult.status === 'fulfilled') setCsrf(csrfResult.value.token);
    const failed = [statusResult, connectionResult, endpointsResult, csrfResult].find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') setNotice({ kind: 'error', text: failed.reason instanceof Error ? failed.reason.message : 'Không thể tải một phần dữ liệu.' });
  };
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15_000); return () => window.clearInterval(timer); }, []);
  const mutate = async (path: string, body?: unknown) => {
    await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : '{}' });
    await load();
  };
  const configure = async (event: FormEvent) => { event.preventDefault(); try { await mutate('/connection/configure', { accountMasked }); setNotice({ kind: 'ok', text: 'Đã lưu kết nối. Bước login ACB sẽ được bật sau POC browser an toàn.' }); } catch (error) { setNotice({ kind: 'error', text: String(error) }); } };
  const createEndpoint = async (event: FormEvent) => { event.preventDefault(); try { await mutate('/webhooks', { name: endpointName, url: endpointURL }); setEndpointName(''); setEndpointURL(''); setNotice({ kind: 'ok', text: 'Đã tạo endpoint ở trạng thái DISABLED.' }); } catch (error) { setNotice({ kind: 'error', text: String(error) }); } };
  const perform = async (path: string) => { try { await mutate(path); setNotice({ kind: 'ok', text: 'Đã ghi nhận thao tác.' }); } catch (error) { setNotice({ kind: 'error', text: String(error) }); } };
  const content = useMemo(() => {
    if (active === 'Kết nối ACB') return <section className="panel"><h2>Kết nối ACB</h2><p className="muted">Chỉ lưu số tài khoản đã che. Mật khẩu, OTP, CAPTCHA và cookie không đi qua form này.</p>{!connected ? <form onSubmit={configure} className="form"><label>Số tài khoản đã che<input aria-label="Số tài khoản đã che" value={accountMasked} onChange={(e) => setAccountMasked(e.target.value)} placeholder="***1234" required /></label><button><KeyRound size={17} /> Lưu kết nối</button></form> : <><dl><dt>Tài khoản</dt><dd>{connection?.connection?.accountMasked}</dd><dt>Trạng thái</dt><dd>{connection?.connection?.state}</dd><dt>Generation</dt><dd>{connection?.connection?.generation}</dd></dl><div className="actions"><button onClick={() => void perform('/connection/pause')}><CirclePause size={17} /> Pause</button><button onClick={() => void perform('/connection/resume')}><RefreshCw size={17} /> Resume</button><button onClick={() => void perform('/connection/sync')}><ListRestart size={17} /> Sync</button></div><p className="gate"><AlertTriangle size={18} /> Login browser, session handoff và polling bị khóa tới khi hoàn tất POC ACB trên VPS.</p></>}</section>;
    if (active === 'Webhooks') return <section className="panel"><h2>Webhook endpoints</h2><p className="muted">Endpoint mới không tự phát dữ liệu lịch sử và luôn bắt đầu ở trạng thái tắt.</p><form onSubmit={createEndpoint} className="form split"><label>Tên<input aria-label="Tên endpoint" value={endpointName} onChange={(e) => setEndpointName(e.target.value)} required /></label><label>HTTPS URL<input aria-label="HTTPS URL" value={endpointURL} onChange={(e) => setEndpointURL(e.target.value)} placeholder="https://example.com/bank-events" required /></label><button><Webhook size={17} /> Tạo endpoint</button></form><div className="table">{endpoints.length === 0 ? <p className="empty">Chưa có endpoint.</p> : endpoints.map((endpoint) => <article key={endpoint.id}><div><strong>{endpoint.name}</strong><p>{endpoint.url}</p></div><span className={`status ${endpoint.status === 'ACTIVE' ? 'good' : ''}`}>{endpoint.status}</span><button onClick={() => void perform(`/webhooks/${endpoint.id}/${endpoint.status === 'ACTIVE' ? 'disable' : 'enable'}`)}>{endpoint.status === 'ACTIVE' ? 'Disable' : 'Enable'}</button></article>)}</div></section>;
    if (active === 'Giao dịch') return <Empty title="Giao dịch" text="Sẽ hiển thị sau khi adapter ACB, parser, pagination và baseline review vượt POC." />;
    if (active === 'Phân phối') return <Empty title="Phân phối & dead-letter" text="Outbox HMAC/retry primitives đã có; worker phát thực tế chờ schema giao dịch và ACB POC." />;
    if (active === 'Polling') return <Empty title="Polling" text="Polling bị tắt an toàn. Không có HTTP request ACB nào được gửi từ foundation này." />;
    if (active === 'Chẩn đoán') return <Empty title="Chẩn đoán" text="Không hiển thị cookie, dse state, OTP hay HTML ngân hàng. Metrics/log production sẽ được thêm cùng monitor." />;
    if (active === 'Audit') return <Empty title="Audit" text="Hành động admin hiện đã ghi audit database; giao diện truy vấn sẽ được thêm khi schema event hoàn chỉnh." />;
    return <><section className="grid"><Card title="ACB connection" value={status?.acb.state ?? 'UNAVAILABLE'} detail={`Coverage: ${status?.acb.coverage ?? 'UNKNOWN'}`} icon={Radio} /><Card title="SQLite WAL" value={status?.storage.status ?? 'UNKNOWN'} detail="Single-process lock, foreign keys và synchronous FULL." icon={Database} /><Card title="Webhook queue" value={`${status?.webhooks.pending ?? 0} pending`} detail={`${status?.webhooks.deadLetter ?? 0} dead-letter`} icon={Webhook} /><Card title="Quản trị" value="Access protected" detail="JWT, role và CSRF được enforce server-side." icon={ShieldCheck} /></section><section className="panel"><h2>Release gate</h2><p className="gate"><AlertTriangle size={18} /> Chưa cho phép login hoặc monitor ACB. Cần live POC: browser sandbox, session handoff, hidden fields, pagination và rate limits.</p></section></>;
  }, [active, accountMasked, connected, connection, endpointName, endpointURL, endpoints, status, csrf]);

  return <main className="shell"><header><div><p className="eyebrow">ACB ONE WEB MONITOR</p><h1>TuanBankGateway</h1><p className="muted">Go backend · Bun frontend · {status?.version ?? 'đang tải'}</p></div><span className="badge">{status?.service ?? 'UNREACHABLE'}</span></header>{notice && <div className={`notice ${notice.kind}`}><span>{notice.kind === 'ok' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}</span><p>{notice.text}</p><button aria-label="Đóng thông báo" onClick={() => setNotice(null)}>×</button></div>}<nav aria-label="Điều hướng quản trị">{nav.map((item) => <button key={item} className={active === item ? 'selected' : ''} onClick={() => setActive(item)}>{item}</button>)}</nav>{content}</main>;
}
function Empty({ title, text }: { title: string; text: string }) { return <section className="panel"><h2>{title}</h2><p className="empty">{text}</p></section>; }
