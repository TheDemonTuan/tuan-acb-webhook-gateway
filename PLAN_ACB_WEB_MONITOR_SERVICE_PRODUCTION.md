# PLAN — ACB Web Monitor Service

## 1. Mục tiêu

Xây dựng một service độc lập để theo dõi giao dịch ACB qua ACB ONE Web, không phụ thuộc email, Android hoặc source Messenger.

Service phải có:

- Theo dõi lịch sử giao dịch ACB gần realtime bằng HTTP request của ACB ONE Web.
- Không giữ Chromium render trang 24/7 nếu không cần.
- Tự phát hiện session ACB hết hạn/logout.
- Khi logout: dừng monitor an toàn, chuyển `AUTH_REQUIRED`, mở sẵn luồng browser re-auth, cảnh báo admin và tự resume ngay sau khi người dùng xác thực xong.
- UI quản trị đầy đủ: trạng thái ACB, giao dịch, webhook, delivery log, dead-letter, polling, session diagnostics và audit.
- Phát webhook HMAC tới Messenger, ERP, website hoặc service khác.
- Dedupe giao dịch để không gửi trùng.
- Storage nhẹ bằng SQLite WAL.
- Docker Compose độc lập.
- Không lưu password/OTP/CAPTCHA plaintext.
- Fail closed nếu ACB đổi HTML/protocol.

---

## 2. Protocol ACB ONE Web đã xác minh

Request lịch sử giao dịch đang dùng:

```text
POST https://online.acb.com.vn/acbib/Request
```

Form state đã quan sát thực tế:

```text
dse_applicationId      = -1
dse_operationName      = ibkacctDetailProc
dse_pageId             = 4
dse_processorState     = acctDetailPage
dse_errorPage          = /ibk/acctinquiry/trans.jsp
dse_nextEventName      = byDate

AccountNbr
virtualAccount
storeName
CheckRef                = false
EdtRef
CheckDoiUng             = false
activeDatetimeYN        = N
FromDate
ToDate
```

State nhạy cảm:

```text
dse_sessionId
dse_processorId
Cookie
```

ACB ONE Web hoạt động kiểu server-rendered/stateful:

```text
Browser
  -> GET/POST /acbib/Request
  -> server state dse_*
  -> HTML response
  -> browser render bảng
```

Bảng lịch sử có các field phù hợp để monitor:

```text
Ngày hiệu lực
Ngày giao dịch
Số GD
Ghi nợ
Ghi có
Số dư
Nội dung giao dịch
```

Observation hiện tại:

```text
idle khoảng 5–10 phút -> có thể logout
có activity 30–60s/lần -> session vẫn sống
```

Không coi đây là SLA chính thức của ACB; phải benchmark thêm absolute session lifetime.

---

## 3. Kiến trúc chốt

Không làm:

```text
Chromium -> refresh DOM mỗi 5 giây -> scrape UI
```

Không làm:

```text
auto password -> auto CAPTCHA -> auto OTP -> retry vô hạn
```

Thiết kế chính:

```text
ACB ONE WEB
   |
   | authenticated session
   v
ACB HTTP Monitor
   |
   +-> bootstrap account detail
   +-> lấy processor state hiện tại
   +-> POST history byDate
   v
HTML Parser
   v
Transaction Normalizer
   v
SQLite WAL
   v
Durable Webhook Outbox
   v
Signed Webhooks
```

Browser chỉ dùng cho:

```text
initial login
+
re-auth khi session chết
```

---

## 4. Deployment khuyến nghị

Một Docker Compose project độc lập nhưng gồm hai runtime container:

```text
acb-monitor-stack
|
+-- acb-monitor
|   +-- API
|   +-- Admin UI
|   +-- HTTP monitor
|   +-- HTML parser
|   +-- SQLite
|   +-- webhook dispatcher
|   +-- scheduler
|
+-- acb-auth-browser
    +-- Chromium
    +-- Playwright
    +-- Xvfb
    +-- noVNC / secure login surface
```

Đây vẫn là một sản phẩm/service duy nhất trong:

```text
/opt/acb-monitor/
compose.yml
```

Tách browser giúp:

- Browser crash không kéo core down.
- Browser attack surface không nằm chung core.
- Core có thể chạy `read_only`, non-root.
- Re-auth có thể restart riêng.
- Sau này thay auth mechanism không ảnh hưởng transaction core.

Nếu bắt buộc đúng một container, có thể gộp browser vào app; không phải mode production khuyến nghị.

---

## 5. Tech stack

Khuyến nghị:

```text
Runtime       Bun hoặc Node.js LTS
Language      TypeScript
HTTP API      Fastify
UI            React + Vite
DB            SQLite WAL
ORM           Drizzle hoặc Kysely
Browser       Playwright Chromium
Validation    Zod
Logging       Pino
HTML parser   Cheerio
Crypto        Node crypto
```

Nếu muốn đồng bộ công nghệ với Messenger repo, dùng Bun/Fastify/TypeScript.

---

## 6. Connection state machine

Không dùng boolean `connected=true/false`.

Dùng state:

```text
UNCONFIGURED
AUTH_REQUIRED
AUTH_STARTING
AUTH_IN_PROGRESS
VERIFYING
MONITORING
DEGRADED
ACB_UNAVAILABLE
PROTOCOL_CHANGED
PAUSED
```

Flow:

```text
UNCONFIGURED
   -> AUTH_REQUIRED
   -> AUTH_STARTING
   -> AUTH_IN_PROGRESS
   -> VERIFYING
   -> MONITORING
```

Failure branches:

```text
MONITORING
  -> network temporary error -> DEGRADED -> MONITORING
  -> login/session expired   -> AUTH_REQUIRED
  -> unknown HTML/protocol   -> PROTOCOL_CHANGED
```

`PROTOCOL_CHANGED` tuyệt đối không tự coi là logout.

---

## 7. Phát hiện logout/session expired

Không chỉ nhìn HTTP status vì ACB có thể trả HTTP 200 nhưng body là login page.

Mỗi response phải được classify thành:

```text
HISTORY_PAGE
ACCOUNT_DETAIL_PAGE
LOGIN_PAGE
OTP_CHALLENGE
CAPTCHA_PAGE
MAINTENANCE_PAGE
UNKNOWN_PAGE
```

### AUTH_REQUIRED khi

```text
redirect về login
OR login form fingerprint xuất hiện
OR field user/password/captcha xuất hiện
OR account bootstrap không còn processor state
OR ACB báo session invalid
```

Khi đó:

```text
stop polling
state = AUTH_REQUIRED
trigger re-auth workflow
```

Không parse transaction từ response này.

---

## 8. Login page fingerprint

Không hard-code một selector duy nhất.

Dùng nhiều signal:

```text
input UserName
input PassWord
input SecurityCode / security-code
operation obkLoginOp
text "Tên truy cập"
text "Mật khẩu"
captcha URL
```

Ví dụ classifier score:

```text
>= 2 strong signals -> LOGIN_PAGE
```

Điều này giảm false positive.

---

## 9. History page fingerprint

History page hợp lệ cần:

```text
known ACB host
expected operation/state
history table tồn tại
column structure hợp lệ
transaction rows parse được
```

Ví dụ:

```text
#table1 present
+
row data có 6 cells
+
date hợp lệ
+
debit/credit parse được
```

Nếu schema không đúng:

```text
UNKNOWN_PAGE / PROTOCOL_CHANGED
```

Không được hiểu là "0 giao dịch".

---

## 10. Re-auth ngay khi bị logout

Mục tiêu là tự động hóa toàn bộ phần chuẩn bị, chỉ để user làm bước xác thực ngân hàng.

Flow:

```text
MONITORING
   |
   | LOGIN_PAGE detected
   v
AUTH_REQUIRED
   |
   +-> stop history polling
   +-> create reauth session
   +-> wake/start auth-browser
   +-> navigate official ACB URL
   +-> emit integration.auth_required
   +-> notify admin
   v
User opens secure login surface
   |
   | login manually
   v
Browser detects authenticated ACB page
   |
   +-> export new cookie/session metadata
   +-> encrypt auth state
   v
VERIFYING
   |
   +-> bootstrap account detail
   +-> test history query
   v
MONITORING
```

Không cần user bấm Resume sau khi login thành công.

---

## 11. Auto-login được phép làm gì

Service có thể tự:

```text
mở Chromium
mở official ACB login URL
khôi phục persistent browser profile
khôi phục trusted-device state nếu còn hợp lệ
prefill username nếu user bật option
phát hiện login thành công
capture session mới
resume monitor
```

Service không tự:

```text
bypass CAPTCHA
solve CAPTCHA
brute-force password
auto read OTP
auto bypass SafeKey
retry credentials loop
```

Nếu persistent session vẫn hợp lệ thì có thể auto-resume hoàn toàn. Nếu ACB yêu cầu challenge mới thì user interaction required.

---

## 12. Re-auth UX

Dashboard banner:

```text
ACB Connection
--------------------------------
Status: AUTH REQUIRED
Last successful poll: 10:32:12
Session age: 3h 14m
Reason: LOGIN_PAGE_DETECTED

[ Login ACB now ]
```

Khi user bấm:

```text
Login ACB now
   -> secure browser panel
   -> user authenticates
   -> Authentication detected
   -> Verifying history access
   -> Monitoring restored
```

---

## 13. Cảnh báo khi cần login

Emit system event:

```json
{
  "type": "integration.auth_required",
  "source": "acb-web-monitor",
  "time": "...",
  "data": {
    "reason": "SESSION_EXPIRED",
    "lastSuccessfulPollAt": "...",
    "loginUrl": "https://monitor.example.com/auth/acb"
  }
}
```

Messenger/Telegram/ERP có thể nhận alert:

```text
ACB Monitor mất phiên đăng nhập.
Cần xác thực lại ACB ONE.
```

Không gửi cookie/session trong alert.

---

## 14. Session Manager

State runtime:

```text
cookies
dse_sessionId
current processorId
lastVerifiedAt
sessionStartedAt
lastActivityAt
failureCount
state
```

Interface:

```ts
interface AcbSessionManager {
  getState(): AcbConnectionState;
  loadEncryptedState(): Promise<void>;
  beginReauth(): Promise<ReauthSession>;
  acceptBrowserAuthState(state: BrowserAuthState): Promise<void>;
  verify(): Promise<SessionVerifyResult>;
  invalidate(reason: string): Promise<void>;
}
```

---

## 15. Auth state encryption

Không lưu plaintext:

```text
cookie.json
storageState.json
.env cookie
dse_sessionId plain text
```

Lưu:

```text
/data/secrets/acb-auth-state.enc
```

Encrypt:

```text
AES-256-GCM
```

Master key:

```text
/run/secrets/acb_auth_master_key
```

Session chỉ decrypt vào RAM khi dùng.

---

## 16. Persistent browser profile

Volume:

```text
acb_browser_profile
```

Mục tiêu:

```text
trusted-device state
browser preferences
session artifacts nếu ACB cho phép reuse
```

Profile volume phải được coi như credential:

```text
owner-only permissions
không share container khác
không backup mặc định
```

---

## 17. Polling loop

Pseudo:

```ts
while (running) {
  if (state !== "MONITORING") {
    await sleep(1000);
    continue;
  }

  const bootstrap = await acb.bootstrapAccountDetail();

  if (bootstrap.kind === "AUTH_REQUIRED") {
    await session.invalidate("SESSION_EXPIRED");
    await reauth.trigger();
    continue;
  }

  if (bootstrap.kind !== "ACCOUNT_DETAIL") {
    await protocolFailure(bootstrap);
    continue;
  }

  const history = await acb.queryHistory({
    processorId: bootstrap.processorId,
    fromDate: currentWindow.from,
    toDate: currentWindow.to
  });

  if (history.kind === "AUTH_REQUIRED") {
    await session.invalidate("SESSION_EXPIRED");
    await reauth.trigger();
    continue;
  }

  if (history.kind !== "HISTORY_PAGE") {
    await protocolFailure(history);
    continue;
  }

  const txs = parser.parse(history.html);
  await transactionService.ingest(txs);
  await sleep(nextPollInterval());
}
```

---

## 18. Bootstrap mỗi poll cycle

Không replay mãi:

```text
same processorId
same POST
same state
```

Flow robust:

```text
GET/bootstrap account detail
   -> validate authenticated page
   -> extract current processor state
POST history
   -> validate history page
```

Ưu điểm:

- detect expired session nhanh;
- tránh stale processor state;
- đúng hơn với server-stateful app;
- fail closed dễ hơn.

Chi phí khoảng 2 request/poll.

---

## 19. Polling strategy

Default khuyến nghị:

```text
NORMAL = 15s
FAST   = 5s
```

Adaptive:

```text
không có payment/order pending -> 15–30s
có payment/order pending        -> 5s
vừa thấy transaction            -> 5s trong 30s
429 / temporary error           -> backoff
```

Không khuyến nghị 1–2s liên tục vì đây là private web interface không có public rate-limit contract.

---

## 20. Session keepalive

Không cần heartbeat riêng nếu chính history polling đã tạo activity.

```text
GET detail
POST history
```

mỗi 5–30s có thể đồng thời giữ session khỏi idle timeout.

Vẫn phải support absolute session expiration nếu ACB có.

---

## 21. Session lifetime metrics

Track:

```text
session_started_at
session_age_seconds
last_successful_poll_at
longest_session_seconds
reauth_count
```

Sau vài ngày sẽ biết:

- chỉ có idle timeout;
- hay có thêm absolute timeout.

---

## 22. Transaction parser

Normalized object:

```ts
interface AcbTransaction {
  transactionNumber: string;
  effectiveDate: string;
  transactionDate: string;
  debit: bigint;
  credit: bigint;
  balance?: bigint;
  description?: string;
}
```

Không dùng float cho tiền.

---

## 23. Credit detection

Rule:

```text
credit > 0
```

Emit:

```text
bank.transaction.credit
```

Debit có thể lưu nhưng không webhook mặc định nếu mục tiêu chỉ là tiền vào.

---

## 24. Dedupe giao dịch

Primary semantic key:

```text
connection/account + transactionNumber
```

DB:

```sql
UNIQUE(connection_id, transaction_number)
```

Backup fingerprint:

```text
SHA256(
  accountHash
  + transactionNumber
  + credit
  + debit
  + transactionDate
)
```

Một transaction dù xuất hiện trong 100 poll vẫn chỉ emit một event.

---

## 25. SQLite schema

### acb_connections

```text
id
name
account_masked
account_hash
state
last_successful_poll_at
last_auth_at
session_started_at
last_error_code
last_error_at
poll_interval_seconds
fast_poll_interval_seconds
enabled
created_at
updated_at
```

### bank_transactions

```text
id
connection_id
transaction_number
effective_date
transaction_date
debit
credit
balance
description
fingerprint
detected_at
parser_version
created_at

UNIQUE(connection_id, transaction_number)
```

### bank_events

```text
id
transaction_id
event_type
payload_json
created_at
```

### webhook_endpoints

```text
id
name
url
enabled
secret_ciphertext
key_id
event_filters_json
timeout_ms
max_attempts
created_at
updated_at
```

### webhook_deliveries

```text
id
endpoint_id
event_id
status
attempt_count
next_attempt_at
last_http_status
last_error
created_at
delivered_at

UNIQUE(endpoint_id, event_id)
```

### reauth_sessions

```text
id
connection_id
status
reason
created_at
browser_ready_at
authenticated_at
verified_at
expired_at
```

### system_events

```text
id
type
severity
payload_json
created_at
```

### audit_logs

```text
id
actor
action
resource_type
resource_id
metadata_json
ip_hash
created_at
```

---

## 26. Durable outbox

Transaction mới:

```text
BEGIN
  INSERT bank_transaction
  INSERT bank_event
  INSERT webhook_delivery rows
COMMIT
```

Worker:

```text
PENDING
 -> claim
 -> POST webhook
 -> 2xx
 -> DELIVERED
```

Nếu container crash, pending delivery vẫn còn trong SQLite.

---

## 27. BankEvent contract

```json
{
  "specVersion": "1.0",
  "id": "bevt_...",
  "type": "bank.transaction.credit",
  "source": "acb-web-monitor",
  "time": "2026-09-10T11:00:12+07:00",
  "data": {
    "bank": "ACB",
    "accountMasked": "***1234",
    "transactionNumber": "2629",
    "credit": "50000",
    "debit": "0",
    "currency": "VND",
    "transactionDate": "10/09/2026",
    "description": "...",
    "detectedAt": "2026-09-10T11:00:12+07:00"
  }
}
```

Không emit full account number.

---

## 28. Webhook HMAC

Headers:

```text
X-Bank-Event-Id
X-Bank-Delivery-Id
X-Bank-Timestamp
X-Bank-Nonce
X-Bank-Key-Id
X-Bank-Signature
```

Canonical input:

```text
timestamp.nonce.rawBody
```

Signature:

```text
HMAC-SHA256(endpointSecret, canonical)
```

Consumer reject nếu:

```text
signature invalid
OR timestamp > 5 phút
OR event ID đã xử lý
```

---

## 29. Webhook retry

Schedule:

```text
0s
2s
5s
15s
30s
60s
2m
5m
15m
```

Sau đó:

```text
DEAD_LETTER
```

UI có:

```text
Retry
Replay
Disable endpoint
Rotate secret
```

---

## 30. Webhook filters

Event types:

```text
bank.transaction.credit
bank.transaction.debit
integration.auth_required
integration.auth_restored
integration.degraded
integration.protocol_changed
```

Filter example:

```json
{
  "banks": ["ACB"],
  "directions": ["CREDIT"],
  "minimumAmount": "0"
}
```

---

## 31. Admin UI navigation

```text
Dashboard
Transactions
Webhooks
Deliveries
ACB Connection
System Events
Settings
Audit
```

---

## 32. Dashboard

Cards:

```text
ACB Connection: MONITORING
Last poll: 2s ago
Session age: 3h 18m
Last transaction: +50,000 VND
Poll interval: 10s
Webhooks: 3 healthy / 0 failing
```

Optional charts:

```text
incoming amount/day
transactions/day
poll latency
webhook latency
session uptime
```

---

## 33. Transactions page

Columns:

```text
Time
Số GD
Direction
Amount
Description
Detected At
Webhook Status
```

Filters:

```text
date range
credit/debit
amount range
transaction number
description
delivery status
```

Actions:

```text
View details
Replay webhook
Copy event ID
```

Không có transfer/refund/bank mutation action.

---

## 34. Webhooks page

List:

```text
Name
URL
Status
Events
Last delivery
Success rate
Latency
```

Create wizard:

```text
1. Name
2. URL
3. Events
4. Filters
5. Generate secret
6. Send test event
7. Enable
```

Secret chỉ hiển thị một lần.

Sau đó:

```text
••••••••  [Rotate]
```

---

## 35. Deliveries page

Show:

```text
event ID
endpoint
attempt
status
HTTP code
latency
next retry
error
```

Statuses:

```text
PENDING
IN_FLIGHT
DELIVERED
RETRYING
DEAD_LETTER
```

---

## 36. ACB Connection page

Sections:

```text
Connection Status
Session
Polling
Authentication
Diagnostics
```

Show:

```text
State
Last successful poll
Last auth
Session age
Re-auth count
Current polling mode
Average query latency
Consecutive errors
```

Actions:

```text
Login / Re-auth
Verify now
Pause
Resume
Force history sync
```

Không hiển thị `dse_sessionId`.

---

## 37. Secure auth browser UI

Route ví dụ:

```text
/admin/auth/acb
```

Flow:

```text
[Start secure browser]
 -> browser starts
 -> open official ACB login
 -> user authenticates
 -> monitor detects authenticated page
 -> auth state exported
 -> browser closes or idles
```

URL allowlist hard-code:

```text
https://online.acb.com.vn/
```

Không cho browse arbitrary URL.

---

## 38. noVNC security

Không expose `6080` public.

Option tốt:

```text
127.0.0.1:6080 + SSH tunnel
```

Hoặc:

```text
Cloudflare Access -> authenticated temporary login surface
```

Auth browser session TTL:

```text
10–15 phút
```

Sau TTL tự đóng.

---

## 39. Re-auth concurrency lock

Chỉ cho một active reauth session:

```text
UNIQUE active reauth per ACB connection
```

Nếu 5 poll cùng detect logout:

```text
1 reauth session
4 request còn lại reuse state
```

Không launch 5 Chromium.

---

## 40. Auto re-auth preparation timeline

Mục tiêu:

```text
T+0ms   detect LOGIN_PAGE
T+10ms  state=AUTH_REQUIRED
T+20ms  stop poll
T+50ms  create reauth session
T+100ms wake auth browser
T+500ms emit alert
T+1–3s browser ready
```

User chỉ còn việc xác thực.

---

## 41. Resume sau login

Browser sidecar báo:

```text
AUTH_STATE_READY
```

Core:

```text
import/decrypt session
 -> bootstrap account detail
 -> query history
 -> catch up missed transactions
 -> MONITORING
 -> emit integration.auth_restored
```

Không cần user bấm Resume.

---

## 42. Catch-up sau re-auth

Ví dụ session chết 15 phút:

```text
11:00 session expired
11:02 tiền vào
11:05 user login lại
```

Sau verify:

```text
query history lookback window
 -> thấy giao dịch 11:02
 -> DB chưa có Số GD
 -> insert
 -> webhook
```

Không mất transaction chỉ vì auth downtime.

---

## 43. Midnight handling

Khoảng 00:00 không chỉ query đúng `today`.

Ví dụ:

```text
00:00–00:15
fromDate = yesterday
toDate   = today
```

Dedupe sẽ loại transaction cũ.

---

## 44. Error classification

Phân biệt:

```text
DNS/TLS timeout
HTTP 5xx
HTTP 429
LOGIN_PAGE
OTP_CHALLENGE
MAINTENANCE_PAGE
UNKNOWN_HTML
```

State mapping:

```text
network error -> DEGRADED
login page    -> AUTH_REQUIRED
maintenance   -> ACB_UNAVAILABLE
unknown HTML  -> PROTOCOL_CHANGED
```

Không biến mọi lỗi thành logout.

---

## 45. Backoff

Network failure:

```text
1s
2s
5s
10s
30s
```

429:

```text
respect Retry-After nếu có
+
reduce poll rate
```

Maintenance:

```text
ACB_UNAVAILABLE
```

Không mở browser login nếu ACB đang maintenance.

---

## 46. Protocol change detection

Nếu:

```text
history table biến mất
column count đổi
hidden state fields biến mất
unexpected authenticated HTML
```

thì:

```text
PROTOCOL_CHANGED
 -> pause transaction emission
 -> alert admin
```

Không đoán parser mới.

---

## 47. Parser versioning

```text
acb-web-parser/v1
acb-web-parser/v2
```

Mỗi transaction lưu `parser_version` để audit.

---

## 48. Security model

Threats:

```text
session theft
browser compromise
webhook spoof
replay
false transaction parse
admin takeover
secret leakage
container escape
```

Controls:

```text
encrypted auth state
separate browser
non-root
read-only FS
cap_drop ALL
no-new-privileges
HMAC webhooks
anti-replay
admin auth / Cloudflare Access
minimal retention
audit logs
```

---

## 49. Không lưu ACB password

Production recommendation:

```text
DO NOT STORE ACB PASSWORD
```

Username có thể optional prefill.

Password/OTP/CAPTCHA:

```text
entered directly into official ACB page by user
```

Core không nhận chúng qua API.

---

## 50. Docker Compose đề xuất

```yaml
name: acb-monitor

services:
  monitor:
    image: ghcr.io/<owner>/acb-monitor:${VERSION}
    container_name: acb-monitor
    restart: unless-stopped
    read_only: true
    init: true
    user: "1000:1000"

    security_opt:
      - no-new-privileges:true

    cap_drop:
      - ALL

    environment:
      NODE_ENV: production
      PORT: 8080
      DATA_DIR: /data
      TZ: Asia/Ho_Chi_Minh
      DEFAULT_POLL_INTERVAL_SECONDS: "15"
      FAST_POLL_INTERVAL_SECONDS: "5"
      AUTH_BROWSER_URL: http://auth-browser:9223
      APP_MASTER_KEY_FILE: /run/secrets/app_master_key

    volumes:
      - acb_monitor_data:/data
      - ./secrets/app_master_key:/run/secrets/app_master_key:ro

    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m

    networks:
      - internal
      - integration_bus

    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
          pids: 100

  auth-browser:
    image: ghcr.io/<owner>/acb-auth-browser:${VERSION}
    container_name: acb-auth-browser
    restart: unless-stopped
    init: true

    security_opt:
      - no-new-privileges:true

    shm_size: 512mb

    environment:
      TZ: Asia/Ho_Chi_Minh
      BROWSER_PROFILE_DIR: /browser-profile

    volumes:
      - acb_browser_profile:/browser-profile

    networks:
      - internal

    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1024M
          pids: 200

volumes:
  acb_monitor_data:
  acb_browser_profile:

networks:
  internal:
    internal: true

  integration_bus:
    external: true
```

Không expose browser port public.

---

## 51. Messenger integration

Messenger chỉ cần generic endpoint:

```text
POST /api/integrations/bank-events
```

Flow:

```text
receive
 -> verify HMAC
 -> anti replay
 -> dedupe event ID
 -> persist
 -> enqueue SYSTEM outbound
 -> return 202
```

Không chờ browser gửi Messenger xong mới ACK webhook.

---

## 52. Event types cho Messenger

```text
bank.transaction.credit
integration.auth_required
integration.auth_restored
integration.degraded
integration.protocol_changed
```

Messenger tự map recipient theo event type.

---

## 53. Public/Admin API

```http
GET /api/status

GET /api/transactions
GET /api/transactions/:id

GET /api/webhooks
POST /api/webhooks
PATCH /api/webhooks/:id
DELETE /api/webhooks/:id
POST /api/webhooks/:id/test
POST /api/webhooks/:id/rotate-secret

GET /api/deliveries
POST /api/deliveries/:id/retry

GET /api/events

POST /api/acb/auth/start
GET  /api/acb/auth/status
POST /api/acb/auth/verify
POST /api/acb/pause
POST /api/acb/resume
POST /api/acb/sync-now

GET /healthz
GET /readyz
```

---

## 54. RBAC

Roles:

```text
OWNER
OPERATOR
VIEWER
```

OWNER:

```text
reauth
webhook secret management
settings
endpoint mutation
```

OPERATOR:

```text
view transactions
retry delivery
sync now
```

VIEWER:

```text
read only
```

---

## 55. Audit log

Log actions:

```text
login flow started
auth restored
webhook created
webhook disabled
secret rotated
poll interval changed
manual retry
pause/resume
```

Không log:

```text
password
cookie
dse_sessionId
OTP
```

---

## 56. Metrics

```text
acb_poll_total
acb_poll_success_total
acb_poll_failure_total
acb_session_expired_total
acb_reauth_total
acb_reauth_duration_seconds
acb_history_latency_ms
bank_transaction_credit_total
bank_transaction_duplicate_total
webhook_delivery_total
webhook_delivery_failed_total
webhook_delivery_latency_ms
```

---

## 57. Health semantics

`/healthz`:

```text
process alive
```

`/readyz`:

```text
app/database/API ready
```

Không fail Docker healthcheck chỉ vì ACB đang `AUTH_REQUIRED`, nếu không Docker sẽ restart vô ích.

Integration state nằm ở `/api/status`.

---

## 58. Status response

```json
{
  "service": "HEALTHY",
  "acb": {
    "state": "MONITORING",
    "lastSuccessfulPollAt": "...",
    "sessionAgeSeconds": 10932,
    "pollIntervalSeconds": 10
  },
  "webhooks": {
    "healthy": 3,
    "degraded": 0
  }
}
```

---

## 59. Retention

Default:

```text
transactions         180 days
webhook deliveries    90 days
system events          30 days
audit logs             90 days
raw HTML                do not store
```

Unknown page debug chỉ lưu hash/fingerprint/sanitized metadata.

---

## 60. Backup

Backup SQLite đúng cách:

```bash
sqlite3 /data/acb-monitor.db ".backup '/backup/acb-monitor.db'"
```

Không backup browser profile/auth state mặc định.

---

## 61. Tests bắt buộc

### Session

```text
valid session
idle expired session
login page HTTP 200
redirect login
missing processor state
maintenance page
unknown page
```

### Parser

```text
credit row
debit row
description row
zero amount
format change
duplicate Số GD
```

### Re-auth

```text
logout detected
one reauth only
browser ready
user login success
auth import
verify success
auto resume
catch-up history
```

### Webhook

```text
valid HMAC
invalid HMAC
expired timestamp
replay
timeout
429
500
duplicate event
dead-letter
manual replay
```

### Crash recovery

```text
crash after transaction insert
crash before webhook send
crash after send before mark-delivered
```

Consumer idempotency phải xử lý duplicate an toàn.

---

## 62. POC acceptance

```text
[ ] login thủ công thành công
[ ] session monitor chạy >= 8h
[ ] polling giữ idle session
[ ] logout detect <= 1 poll interval
[ ] reauth UI hoạt động
[ ] resume tự động sau auth
[ ] catch-up không mất transaction
[ ] credit detection đúng
[ ] duplicate = 0
[ ] webhook retry đúng
```

---

## 63. Production acceptance

```text
[ ] chạy canary 7 ngày
[ ] không false credit event
[ ] không duplicate Messenger alert
[ ] session expiry được báo ngay
[ ] reauth không làm mất transaction
[ ] parser fail closed
[ ] no plaintext credentials
[ ] browser không public
[ ] HMAC + replay protection
[ ] backup/restore tested
```

---

## 64. Latency SLO

Nếu ACB history xuất hiện transaction ngay và poll 5s:

```text
poll detection P50 ~2.5s
poll detection P95 ~5s + query latency
```

Internal target:

```text
transaction detected -> first webhook attempt < 500ms
```

Không cam kết latency từ ACB ledger đến ACB Web history vì đó là phần ACB kiểm soát.

---

## 65. Failure recovery summary

```text
ACB logout
 -> AUTH_REQUIRED
 -> browser reauth ready
 -> manual auth
 -> verify
 -> catch-up
 -> monitoring

ACB down
 -> ACB_UNAVAILABLE
 -> backoff
 -> auto retry

HTML changed
 -> PROTOCOL_CHANGED
 -> stop event emission
 -> alert

Webhook down
 -> durable retry

Messenger down
 -> gateway vẫn monitor
 -> pending delivery được giữ
```

---

## 66. Không mất transaction khi re-auth

Ví dụ:

```text
11:00 session expired
11:02 tiền vào
11:05 user re-login
```

Sau verify:

```text
history lookback
 -> thấy transaction 11:02
 -> Số GD chưa có trong DB
 -> insert
 -> webhook
```

Vì vậy auth downtime không đồng nghĩa event loss.

---

## 67. Alert redundancy

`integration.auth_required` có thể gửi tới:

```text
Messenger
Telegram / secondary webhook
UI red banner
```

Không phụ thuộc duy nhất một kênh.

---

## 68. Secret rotation

Mỗi endpoint hỗ trợ:

```text
current_secret
previous_secret
key_id
```

Rotation flow:

```text
generate new
 -> consumer accepts new+old
 -> gateway switches new
 -> observation window
 -> remove old
```

---

## 69. API hardening

Admin UI/API:

```text
Cloudflare Access
hoặc VPN/SSH private access
```

Require:

```text
CSRF protection
secure cookies
SameSite
rate limiting
body size limit
security headers
```

Machine webhook auth tách riêng khỏi admin session.

---

## 70. Docker hardening

Monitor:

```text
non-root
read_only
no-new-privileges
cap_drop ALL
tmpfs /tmp
CPU/RAM/PID limits
```

Browser:

```text
no Docker socket
no privileged
no host network
no host filesystem
internal network only
```

Tuyệt đối không mount:

```text
/var/run/docker.sock
```

---

## 71. Recommended defaults

```env
POLL_INTERVAL_SECONDS=15
FAST_POLL_INTERVAL_SECONDS=5
HISTORY_LOOKBACK_DAYS=1
NETWORK_TIMEOUT_MS=5000
MAX_CONSECUTIVE_NETWORK_ERRORS=5
WEBHOOK_TIMEOUT_MS=5000
WEBHOOK_MAX_ATTEMPTS=8
AUTH_SESSION_TTL_MINUTES=15
TRANSACTION_RETENTION_DAYS=180
DELIVERY_RETENTION_DAYS=90
STORE_RAW_HTML=false
STORE_FULL_ACCOUNT=false
```

---

## 72. Development phases

### Phase 0 — fixtures

Capture sanitized examples:

```text
account detail page
history page
login page
maintenance/unknown page nếu có
```

### Phase 1 — Core

```text
Fastify
SQLite
config
health
UI shell
```

### Phase 2 — ACB HTTP client

```text
session manager
bootstrap account detail
history POST
page classifier
parser
```

### Phase 3 — Transaction domain

```text
normalize
dedupe
DB
```

### Phase 4 — Webhook subsystem

```text
endpoint CRUD
HMAC
durable outbox
retry
dead-letter
```

### Phase 5 — Auth browser

```text
Playwright
noVNC
auth detection
auth-state export
```

### Phase 6 — Re-auth orchestration

```text
logout detect
alert
browser wake
user auth
verify
catch-up
auto resume
```

### Phase 7 — Full UI

```text
dashboard
transactions
webhooks
deliveries
connection
audit
settings
```

### Phase 8 — Messenger consumer

```text
generic BankEvent endpoint
recipient routing
SYSTEM immediate outbound
```

### Phase 9 — Hardening

```text
encryption
RBAC
Cloudflare Access
retention
metrics
backup
```

### Phase 10 — 7-day canary

Manual cross-check với ACB ONE trước khi dùng cho payment-critical automation.

---

## 73. Roadmap sau V1

V1:

```text
ACB Web
transactions
webhooks
reauth
dashboard
```

V2:

```text
SePay provider
ACB Email reconciliation provider
multi-source correlation
```

V3:

```text
multiple accounts
multiple banks
payment-order matcher
```

Core domain vẫn là:

```text
BankEvent
```

---

## 74. Definition of Done

Service production-ready khi:

```text
1. User login ACB qua secure browser.
2. Auth state được lưu encrypted.
3. HTTP monitor query history định kỳ.
4. Polling giữ idle session sống trong benchmark.
5. Login page/session expiry được detect đúng.
6. AUTH_REQUIRED tạo trong <= 1 poll cycle.
7. Auth browser tự sẵn sàng.
8. User login xong hệ thống resume tự động.
9. Catch-up lấy transaction bị bỏ lỡ.
10. CREDIT dedupe theo Số GD.
11. Webhook HMAC + replay protection hoạt động.
12. Retry/dead-letter hoạt động.
13. UI quản lý được toàn bộ lifecycle.
14. Không lưu password/OTP.
15. Browser không exposed public.
16. Parser fail closed.
17. Messenger không chứa ACB-specific logic.
```

---

## 75. Kiến trúc cuối cùng

```text
               ACB ONE Web
                    |
             authenticated session
                    |
                    v
          +---------------------+
          | ACB HTTP Monitor    |
          |---------------------|
          | session classifier  |
          | bootstrap detail    |
          | history query       |
          | HTML parser         |
          +----------+----------+
                     |
                     v
          +---------------------+
          | Transaction Core    |
          | SQLite + dedupe     |
          +----------+----------+
                     |
                     v
          +---------------------+
          | Durable Webhooks    |
          | HMAC + retry        |
          +-----+----------+----+
                |          |
                v          v
           Messenger      ERP

Session expired:

HTTP Monitor
   -> detect logout
   -> AUTH_REQUIRED
   -> wake secure browser
   -> notify admin
   -> user authenticates
   -> import session
   -> verify
   -> catch-up
   -> auto resume
```

Đây là thiết kế cân bằng tốt nhất giữa:

```text
near realtime
chi phí thấp
không Android
không phụ thuộc email
không giữ Chromium nặng 24/7
bảo mật tài khoản
không bypass security controls
recovery nhanh khi logout
webhook/API độc lập với Messenger
```
