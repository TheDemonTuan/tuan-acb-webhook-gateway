# PLAN V4 — Standalone Bank Event Gateway

## 1. Quyết định kiến trúc

Tách hoàn toàn tính năng nhận tiền ra khỏi repo Messenger thành một service riêng:

```text
bank-event-gateway
```

Service này tự làm:

```text
ACB Email/Gmail
  -> xác thực email
  -> parse giao dịch
  -> dedupe
  -> chuẩn hóa BankEvent
  -> lưu durable outbox
  -> phát webhook ký HMAC
  -> consumer bất kỳ
```

Consumer có thể là:

```text
facebook-messenger-ai-rep
ERP
website
Telegram service
Discord service
order service
custom backend
```

Gateway không biết Playwright, AI, Facebook participant, conversation hay DB của Messenger.

---

## 2. Kiến trúc tổng thể

```text
ACB
  |
  | Email biến động số dư
  v
Gmail
  |
  | Gmail users.watch
  v
Google Pub/Sub
  |
  | StreamingPull
  v
+-----------------------------------+
| bank-event-gateway                |
|                                   |
| Gmail Source                      |
| Email Auth Verifier               |
| ACB Parser                        |
| BankEvent Normalizer              |
| SQLite WAL                        |
| Durable Webhook Outbox            |
| HMAC Webhook Dispatcher           |
+---------+-------------+-----------+
          |             |
          |             +--> ERP / Website / Other
          |
          +--> Messenger repo
```

---

## 3. Mục tiêu isolation

Nếu Messenger down:

```text
bank-event-gateway vẫn:
- nhận email
- parse
- lưu transaction
- lưu pending webhook
- retry
```

Khi Messenger sống lại:

```text
pending webhook -> retry -> nhận event
```

Nếu Bank Gateway down:

```text
Messenger vẫn chat
AI vẫn chạy
browser-agent vẫn chạy
```

Không share lifecycle.

---

## 4. Không share database với Messenger

Không cho gateway truy cập:

```text
messenger_postgres
conversations
participants
outbound_actions
jobs
```

Không import:

```text
@messenger/db
@messenger/contracts
```

Gateway có storage riêng.

### V1: SQLite WAL

Để đúng mục tiêu một container duy nhất:

```text
/data/bank-event-gateway.db
```

Cấu hình:

```text
journal_mode=WAL
foreign_keys=ON
busy_timeout
synchronous=NORMAL
```

Volume:

```text
bank_event_data:/data
```

Đủ phù hợp cho một tài khoản cá nhân và lượng event nhỏ/trung bình.

Sau này muốn scale nhiều replica thì thay SQLite bằng PostgreSQL nhưng giữ nguyên API/event contract.

---

## 5. Repo mới

```text
bank-event-gateway/
├── src/
│   ├── app.ts
│   ├── config.ts
│   ├── domain/
│   │   ├── bank-event.ts
│   │   ├── transaction.ts
│   │   └── webhook.ts
│   ├── sources/
│   │   └── gmail/
│   │       ├── gmail-client.ts
│   │       ├── gmail-watch.ts
│   │       ├── pubsub-subscriber.ts
│   │       ├── history-sync.ts
│   │       └── mime-reader.ts
│   ├── security/
│   │   ├── email-auth-verifier.ts
│   │   ├── webhook-signer.ts
│   │   ├── secret-encryption.ts
│   │   └── replay.ts
│   ├── parsers/
│   │   ├── registry.ts
│   │   └── acb/
│   │       ├── parser.ts
│   │       ├── fingerprint.ts
│   │       └── normalizer.ts
│   ├── storage/
│   │   ├── db.ts
│   │   ├── migrations.ts
│   │   └── repositories/
│   ├── outbox/
│   │   ├── dispatcher.ts
│   │   ├── retry-policy.ts
│   │   └── worker.ts
│   ├── api/
│   │   ├── health.ts
│   │   ├── endpoints.ts
│   │   ├── events.ts
│   │   └── diagnostics.ts
│   └── metrics/
│       └── metrics.ts
├── tests/
│   ├── fixtures/acb/
│   ├── parser.test.ts
│   ├── dedupe.test.ts
│   ├── webhook-signature.test.ts
│   ├── replay.test.ts
│   └── crash-recovery.test.ts
├── Dockerfile
├── compose.yml
├── .env.example
└── README.md
```

---

## 6. BankEvent contract

Không gửi raw email sang consumer.

Ví dụ:

```json
{
  "specVersion": "1.0",
  "id": "bevt_019...",
  "type": "bank.transaction.credit",
  "source": "bank-event-gateway/acb-email",
  "time": "2026-09-09T16:25:59+07:00",
  "subject": "bank-account:acb:***8827",
  "data": {
    "bank": "ACB",
    "direction": "CREDIT",
    "amount": "50000",
    "currency": "VND",
    "accountMasked": "***8827",
    "description": "RUT TIEN TU VI MOMO ...",
    "transactionAt": "2026-09-09T16:22:30+07:00",
    "emailReceivedAt": "2026-09-09T16:25:59+07:00",
    "reference": null,
    "verification": {
      "source": "EMAIL",
      "spf": "PASS",
      "dkim": "PASS",
      "dmarc": "PASS",
      "dkimDomain": "acb.com.vn"
    }
  }
}
```

Tiền dùng decimal string:

```text
"50000"
```

không dùng float.

---

## 7. Privacy

Default không emit:

```text
full Gmail address
full raw MIME
full account number
balance
OAuth token
DKIM blob
```

Chỉ emit dữ liệu consumer cần.

Default:

```text
PRIVACY_MODE=MASKED
```

---

## 8. Webhook outbound là API chính

Gateway có danh sách endpoint:

```text
Name: Messenger Alerts
URL: http://messenger-core:3000/api/integrations/bank-events
Events: bank.transaction.credit
Secret: random 32-64 bytes
```

Hoặc external:

```text
https://erp.example.com/webhooks/bank-events
```

Một event có thể fan-out:

```text
event
  +--> Messenger
  +--> ERP
  +--> Website
```

Endpoint fail không block endpoint khác.

---

## 9. HMAC webhook signature

Headers:

```http
Content-Type: application/json
X-Bank-Event-Id: bevt_019...
X-Bank-Timestamp: 1788950000
X-Bank-Nonce: 8d2f...
X-Bank-Key-Id: key-2026-09
X-Bank-Signature: v1=<hex>
X-Bank-Delivery-Id: bdel_019...
```

Canonical payload:

```text
timestamp + "." + nonce + "." + rawBody
```

Signature:

```text
HMAC-SHA256(endpointSecret, canonicalPayload)
```

Consumer dùng constant-time compare.

---

## 10. Replay protection

Consumer reject nếu:

```text
abs(now - timestamp) > 300 seconds
```

Và phải có event idempotency:

```text
external_event_id UNIQUE
```

Signature đúng nhưng event cũ/replay vẫn không được xử lý lại.

---

## 11. Delivery semantics

Webhook:

```text
at-least-once
```

Network không thể bảo đảm exactly-once.

Gateway bảo đảm:

```text
durable event
durable delivery
idempotent retry
```

Consumer bảo đảm:

```text
same event id -> process once
```

---

## 12. Durable Outbox

Không làm:

```text
INSERT transaction
COMMIT
POST webhook
```

mà không lưu delivery.

Đúng:

```text
BEGIN
  INSERT bank_transaction
  INSERT bank_event
  INSERT webhook_delivery status=PENDING
COMMIT
```

Worker:

```text
PENDING
 -> claim
 -> POST
 -> 2xx
 -> DELIVERED
```

Nếu container crash thì delivery vẫn còn trong SQLite.

---

## 13. Retry policy

Attempt đầu:

```text
immediate
```

Sau đó:

```text
2s
5s
15s
30s
60s
2m
5m
15m
```

Cuối cùng:

```text
DEAD_LETTER
```

Không spin retry liên tục.

---

## 14. HTTP semantics

```text
2xx        -> success
408        -> retry
429        -> retry
5xx        -> retry

400/401/
403/404/
422        -> configuration/security error
```

Duplicate consumer có thể trả:

```text
200 duplicate=true
```

và gateway coi là success.

---

## 15. Circuit breaker

Ví dụ:

```text
10 failures liên tục
 -> OPEN 60s
 -> HALF_OPEN
 -> probe
```

Một consumer lỗi không được làm gateway nghẽn.

---

## 16. Kết nối cùng VPS — khuyến nghị

Không đi vòng Internet.

Tạo network chung:

```bash
docker network create integration_bus
```

Gateway:

```yaml
networks:
  integration_bus:
    external: true
```

Messenger core thêm vào cùng network bằng compose override.

URL gateway gọi:

```text
http://messenger-core:3000/api/integrations/bank-events
```

Dù là private Docker network vẫn ký HMAC.

---

## 17. Kết nối consumer khác VPS

```text
Gateway
 -> HTTPS
 -> consumer
```

Bắt buộc:

```text
TLS
HMAC
timestamp
replay protection
timeout
rate limiting
```

Không cho insecure HTTP trên Internet.

---

## 18. Gmail không cần public webhook

Nguồn Gmail dùng:

```text
users.watch
 -> Pub/Sub
 -> StreamingPull subscriber
```

Gateway chủ động kết nối outbound tới Google.

Không cần:

```text
public Pub/Sub callback
Cloudflare Access bypass
public ingress
```

Đây là security tốt hơn.

---

## 19. Admin API

Có thể chỉ bind localhost:

```text
127.0.0.1:8090
```

Routes:

```http
GET  /healthz
GET  /readyz

GET  /api/events
GET  /api/transactions
GET  /api/deliveries
GET  /api/dead-letter

GET    /api/webhook-endpoints
POST   /api/webhook-endpoints
PATCH  /api/webhook-endpoints/:id
DELETE /api/webhook-endpoints/:id

POST /api/webhook-endpoints/:id/test
POST /api/deliveries/:id/retry
```

Nếu expose web UI thì đặt sau Cloudflare Access.

---

## 20. ACB fingerprint đã xác minh

Từ email thật:

```text
From:
mailalert@acb.com.vn

Subject:
ACB-Dich vu bao so du tu dong

DKIM:
PASS

DKIM domain:
acb.com.vn

selector:
s1

SPF:
PASS

DMARC:
PASS
```

Credit:

```text
Giao dịch mới nhất:Ghi có +50,000.00 VND.
```

Debit:

```text
Giao dịch mới nhất:Ghi nợ -50,000.00 VND.
```

Content:

```text
Nội dung giao dịch: ...
```

Chỉ emit credit event khi:

```text
From exact
AND SPF PASS
AND DKIM PASS
AND d=acb.com.vn
AND DMARC PASS
AND subject known
AND template known
AND CREDIT parse được
AND amount parse được
```

Sai/bất thường:

```text
QUARANTINE
```

---

## 21. Gmail near-realtime

Fast path:

```text
users.watch
 -> Pub/Sub StreamingPull
 -> historyId
 -> history.list
 -> messageAdded
 -> messages.get
 -> verify/parse
```

Gateway lưu:

```text
last_history_id
watch_expiration
```

Watch renew hàng ngày.

Fallback safety:

```text
history reconciliation mỗi 60s
```

---

## 22. Dedupe source

Bắt buộc:

```text
UNIQUE(gmail_message_id)
UNIQUE(rfc_message_id)
```

Không dùng thread ID vì ACB cùng subject có thể bị Gmail gom chung thread.

---

## 23. Transaction dedupe

Phase đầu:

```text
SHA256(
 bank
 + direction
 + amount
 + normalized description
 + transaction timestamp
)
```

Store:

```text
fingerprint UNIQUE
```

Sau khi xác minh được ACB reference thật sự unique thì mới dùng `(bank, reference)`.

---

## 24. SQLite schema

### source_messages

```text
id
gmail_message_id UNIQUE
rfc_message_id UNIQUE
gmail_history_id
received_at
sender
subject
spf
dkim
dmarc
dkim_domain
parser_status
parser_version
created_at
```

### bank_transactions

```text
id
source_message_id
bank
direction
amount
currency
account_masked
description
transaction_at
fingerprint UNIQUE
created_at
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
event_filter_json
timeout_ms
created_at
updated_at
```

### webhook_deliveries

```text
id
event_id
endpoint_id
status
attempt_count
next_attempt_at
last_http_status
last_error
created_at
delivered_at

UNIQUE(event_id, endpoint_id)
```

---

## 25. Encrypt endpoint secrets

Gateway có:

```env
APP_MASTER_KEY=<random 32 bytes>
```

DB chỉ lưu ciphertext.

Dùng authenticated encryption, ví dụ:

```text
AES-256-GCM
```

Không log plaintext secret.

---

## 26. Docker Compose — một container chính

```yaml
name: bank-event-gateway

services:
  gateway:
    image: ghcr.io/<owner>/bank-event-gateway:${VERSION}
    container_name: bank-event-gateway
    restart: unless-stopped

    read_only: true
    init: true
    user: "1000:1000"

    cap_drop:
      - ALL

    security_opt:
      - no-new-privileges:true

    environment:
      NODE_ENV: production
      PORT: 8090
      DATA_DIR: /data
      TZ: Asia/Ho_Chi_Minh

      GMAIL_USER: ${GMAIL_USER}
      GOOGLE_PROJECT_ID: ${GOOGLE_PROJECT_ID}
      GOOGLE_PUBSUB_SUBSCRIPTION: ${GOOGLE_PUBSUB_SUBSCRIPTION}

      ACB_EMAIL_FROM: mailalert@acb.com.vn
      ACB_EMAIL_SUBJECT: ACB-Dich vu bao so du tu dong
      ACB_DKIM_DOMAIN: acb.com.vn

      APP_MASTER_KEY_FILE: /run/secrets/app_master_key
      GOOGLE_CREDENTIALS_FILE: /run/secrets/google_credentials

    volumes:
      - bank_event_data:/data
      - ./secrets/app_master_key:/run/secrets/app_master_key:ro
      - ./secrets/google_credentials.json:/run/secrets/google_credentials:ro

    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m

    networks:
      - integration_bus

    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
          pids: 80

    healthcheck:
      test:
        ["CMD-SHELL", "node -e 'fetch(\"http://127.0.0.1:8090/readyz\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'"]
      interval: 10s
      timeout: 3s
      retries: 3

    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  bank_event_data:

networks:
  integration_bus:
    external: true
```

Không publish port nếu chỉ chạy machine-to-machine.

Admin local override:

```yaml
services:
  gateway:
    ports:
      - "127.0.0.1:8090:8090"
```

---

## 27. Resource target

Không Chromium, không AI:

```text
RAM target: 80–200 MB
Docker limit: 256 MB
CPU idle: rất thấp
```

---

## 28. Messenger sau khi tách

Messenger chỉ thêm **generic webhook consumer**:

```http
POST /api/integrations/bank-events
```

Không thêm:

```text
Gmail API
Pub/Sub
ACB parser
bank transaction storage
email SPF/DKIM parsing
```

Flow Messenger:

```text
webhook
 -> verify HMAC
 -> timestamp/replay
 -> event-id dedupe
 -> match route
 -> create SYSTEM outbound
 -> BROWSER_SEND
 -> Messenger
```

---

## 29. Không tái sử dụng INTERNAL_HMAC_SECRET

Repo Messenger hiện có `INTERNAL_HMAC_SECRET`.

Không dùng chung.

Tạo:

```env
BANK_EVENT_WEBHOOK_SECRET=<random>
```

Lý do:

```text
key separation
```

Một integration secret lộ không ảnh hưởng internal auth khác.

---

## 30. Messenger persistence cho event

Thêm bảng nhỏ:

```text
integration_events
------------------
id
provider
external_event_id UNIQUE
event_type
status
received_at
processed_at
metadata
```

Mục tiêu:

```text
idempotency
audit
diagnostics
```

Không lưu raw email.

---

## 31. Recipient routing nằm ở Messenger

Gateway không biết Facebook participant.

Messenger config:

```text
event.type = bank.transaction.credit
bank = ACB
    ↓
Recipients:
- Owner
- Accounting
```

Messenger đã biết participant/conversation nên routing ở đây là đúng separation.

---

## 32. Message template nằm ở Messenger

Ví dụ:

```text
💰 ACB báo có

+50.000 ₫
Nội dung: ...
Thời gian GD: 16:22:30

Nguồn: ACB Email
```

Gateway không render message riêng cho Messenger.

ERP có thể dùng cùng event theo cách khác.

---

## 33. Delivery mode trong Messenger

Event consumer tạo:

```text
actor = SYSTEM
source = BANK_EVENT
deliveryMode = IMMEDIATE
```

Không đi:

```text
AI
debounce
typing simulation
```

Vẫn giữ:

```text
OutboundRepository
PostgreSQL Job
BROWSER_SEND
single sender
SEND_UNCERTAIN safety
```

---

## 34. Hai mode kết nối

### Mode A — cùng VPS, khuyến nghị

```text
bank-event-gateway
 -> integration_bus
 -> messenger-core
```

Ưu:

```text
không Internet
không Cloudflare roundtrip
latency thấp
ít failure point
```

### Mode B — khác VPS

```text
gateway
 -> HTTPS
 -> consumer
```

Require HMAC + TLS + replay protection.

---

## 35. Fan-out nhiều consumer

Ví dụ:

```text
Endpoint 1:
Messenger

Endpoint 2:
Shop API

Endpoint 3:
ERP
```

Mỗi endpoint có filter:

```json
{
  "types": ["bank.transaction.credit"],
  "banks": ["ACB"],
  "minimumAmount": "0"
}
```

---

## 36. Gateway không nhận command từ Messenger

Quan hệ mặc định:

```text
Gateway emits
Messenger consumes
```

Không cần Messenger gọi ngược Gateway.

Nếu cần quản lý gateway thì dùng admin API riêng.

---

## 37. Health

`/healthz`:

```text
process alive
```

`/readyz` chỉ 200 nếu:

```text
SQLite writable
Gmail OAuth valid
Pub/Sub subscriber connected
watch valid
outbox worker alive
```

States:

```text
HEALTHY
DEGRADED
AUTH_EXPIRED
WATCH_EXPIRED
PARSER_UNKNOWN
DELIVERY_DEGRADED
```

---

## 38. Metrics

```text
gmail_notifications_total
gmail_messages_fetched_total
acb_emails_verified_total
acb_emails_rejected_total
acb_parse_failures_total
bank_credit_events_total
bank_duplicate_events_total
webhook_delivery_total
webhook_delivery_retry_total
webhook_delivery_dead_letter_total
gmail_to_event_latency_ms
event_to_webhook_attempt_latency_ms
```

---

## 39. Logging

Không log:

```text
OAuth token
webhook secret
full account
raw email
full balance
```

Log event IDs, endpoint name, attempt, status, latency.

---

## 40. Raw email retention

Default:

```text
STORE_RAW_EMAIL=false
```

Nếu debug quarantine:

```text
encrypted
24h retention
```

Không lưu MIME vô thời hạn.

---

## 41. Threat model

Fake sender:

```text
From spoof
 -> DKIM/SPF/DMARC fail
 -> reject
```

Replay:

```text
timestamp expired / duplicate event
 -> reject
```

Duplicate Pub/Sub:

```text
gmail_message_id UNIQUE
```

Consumer down:

```text
durable retry
```

Gateway crash:

```text
SQLite WAL + durable outbox
```

ACB đổi template:

```text
unknown fingerprint
 -> quarantine
 -> không phát credit event
```

---

## 42. Near-realtime target

Fast path:

```text
Gmail nhận email ACB
 -> Pub/Sub
 -> StreamingPull
 -> parse + SQLite
 -> webhook
 -> Messenger enqueue
```

Target Gateway:

```text
Gmail arrival -> first webhook attempt

P50 < 1s
P95 < 3s
P99 < 10s
```

Cùng VPS, private webhook overhead chỉ mức milliseconds.

ACB transaction -> Gmail vẫn là latency ngoài hệ thống.

---

## 43. Backpressure

Source ingestion không chờ webhook.

```text
ingest
 -> persist
 -> enqueue outbox
 -> ACK source
```

Workers:

```text
WEBHOOK_CONCURRENCY=10
PER_ENDPOINT_CONCURRENCY=2-4
```

---

## 44. Endpoint timeout

```text
CONNECT_TIMEOUT=2s
REQUEST_TIMEOUT=5s
```

Messenger endpoint phải ACK nhanh.

---

## 45. Messenger ACK behavior

Đúng:

```text
receive
verify
dedupe
persist
enqueue outbound
COMMIT
return 202
```

Không chờ Playwright gửi xong mới trả response.

Response:

```http
202 Accepted
```

```json
{
  "accepted": true,
  "eventId": "bevt_019...",
  "duplicate": false
}
```

Duplicate:

```json
{
  "accepted": true,
  "eventId": "bevt_019...",
  "duplicate": true
}
```

---

## 46. Development phases

### Phase 1 — Standalone skeleton

```text
Fastify
SQLite
health
Docker
config
```

### Phase 2 — Gmail source

```text
OAuth
users.watch
Pub/Sub StreamingPull
history sync
```

### Phase 3 — ACB security/parser

```text
SPF/DKIM/DMARC
known sender
known subject
credit/debit parser
```

### Phase 4 — BankEvent domain

```text
normalization
transaction dedupe
```

### Phase 5 — Webhook outbox

```text
endpoints
HMAC
retry
dead letter
circuit breaker
```

### Phase 6 — Messenger consumer

Chỉ thêm:

```text
POST /api/integrations/bank-events
HMAC verifier
event dedupe
routing
SYSTEM immediate outbound
```

### Phase 7 — Private network

```text
integration_bus
```

### Phase 8 — Dashboard

Làm UI sau khi core stable.

---

## 47. Tests bắt buộc

Gateway:

```text
valid ACB credit
valid ACB debit
spoof From
DKIM fail
DMARC fail
unknown template
duplicate Gmail event
duplicate transaction fingerprint
crash before webhook
consumer 500
consumer timeout
consumer 429
dead-letter
secret rotation
```

Messenger:

```text
valid signature
invalid signature
expired timestamp
duplicate event
unknown event
recipient routing
immediate delivery
SEND_UNCERTAIN
```

---

## 48. Secret rotation

Endpoint hỗ trợ:

```text
current_secret
previous_secret
```

Header:

```text
X-Bank-Key-Id
```

Consumer accept current/previous trong rotation window rồi bỏ previous.

---

## 49. Versioning

Event:

```text
specVersion = 1.0
```

Messenger endpoint generic:

```text
/api/integrations/bank-events
```

Không đặt:

```text
/api/acb/email
```

Sau này gateway có thể ingest:

```text
ACB Email
SePay
payOS
ACB Direct API
MoMo
KienlongBank
```

nhưng vẫn emit cùng `BankEvent`.

---

## 50. Chuyển sang SePay sau này

Chỉ thêm provider mới ở Gateway:

```text
SePay webhook
 -> verify
 -> normalize
 -> BankEvent
```

Messenger không sửa.

---

## 51. Deploy độc lập

Hai stack:

```text
/opt/messenger-ai/
  compose.prod.yml

/opt/bank-event-gateway/
  compose.yml
```

Deploy Gateway:

```bash
docker compose -f /opt/bank-event-gateway/compose.yml pull
docker compose -f /opt/bank-event-gateway/compose.yml up -d
```

Restart Gateway không restart Messenger và ngược lại.

---

## 52. Backup

Backup SQLite đúng cách bằng SQLite backup API/CLI:

```bash
sqlite3 /data/bank-event-gateway.db ".backup '/backup/gateway.db'"
```

Không copy file DB đang write một cách tùy tiện.

---

## 53. Kiến trúc cuối

```text
ACB
 |
 v
Gmail
 |
 v
Pub/Sub
 |
 v
+--------------------------+
| Bank Event Gateway       |
|--------------------------|
| verify ACB email         |
| parse                    |
| normalize                |
| dedupe                   |
| SQLite WAL               |
| durable outbox           |
| HMAC signer              |
+-----------+--------------+
            |
            +-------------------> ERP / Website
            |
            v
     Messenger Consumer
            |
            v
     SYSTEM outbound
            |
            v
       BROWSER_SEND
            |
            v
       Messenger
```

---

## 54. Ownership boundary

### Bank Event Gateway sở hữu

```text
Gmail
ACB parser
email security
bank transactions
dedupe
webhook endpoints
webhook signing
retry/outbox
```

### Messenger sở hữu

```text
webhook verification
event idempotency
recipient selection
message template
Messenger delivery
```

### Không share

```text
database
job queue
domain internals
deployment lifecycle
source code packages
```

### Chỉ share

```text
versioned HTTP BankEvent contract
+
endpoint-specific HMAC secret
```

Đây là separation phù hợp nhất cho mục tiêu độc lập, nhẹ, bảo mật,
near-realtime và dễ thay nguồn ACB Email bằng API/SePay sau này.
