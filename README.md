# Standalone Bank Event Gateway (`bank-event-gateway`)

Hệ thống Gateway độc lập chuyên tiếp nhận, xác thực bảo mật và chuẩn hóa các thông báo biến động số dư ngân hàng (ACB) từ Email (qua Gmail API và Google Cloud Pub/Sub), lưu trữ bền vững (SQLite WAL + Durable Outbox) và phát Webhook bảo mật (ký HMAC-SHA256) tới các consumer backend tùy chọn (Messenger Bot, ERP, Order Service, v.v.).

---

## 1. Kiến trúc tổng thể

```text
Ngân hàng ACB
     │ (Email Báo Có)
     ▼
Hộp thư Gmail chuyên dụng
     │
     │ users.watch
     ▼
Google Cloud Pub/Sub ──── StreamingPull ────┐
                                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    bank-event-gateway                       │
│                                                             │
│ 1. Gmail Ingestion (Raw RFC 822 MIME fetch)                 │
│ 2. Email Auth Verifier (SPF, DKIM mx.google.com alignment)  │
│ 3. Deterministic ACB Parser (Chỉ nhận CREDIT; DEBIT ignored)│
│ 4. Transaction Fingerprint & Deduplication                  │
│ 5. SQLite WAL Storage (Atomic Outbox Commit)                │
│ 6. SSRF-Guarded & DNS-Pinned HTTPS Webhook Dispatcher       │
│ 7. HMAC-SHA256 Payload Signature with Timestamp & Key-ID    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼ HTTPS (HMAC Signature)
                   Consumer Backend / Webhook
               (Messenger / ERP / Website Backend)
```

---

## 2. Tính năng bảo mật & độ tin cậy

- **Email Authentication Guard**: Kiểm tra kết quả SPF, DKIM, DMARC chính thức từ header `Authentication-Results` của `mx.google.com`. Từ chối email giả mạo From, forwarded mail, hoặc giả mạo header.
- **Chỉ nhận Tiền Vào (Credit)**: Email biến động số dư báo Nợ (Debit) được ghi nhận trạng thái `IGNORED`, không phát sinh sự kiện tài chính hoặc webhook.
- **Amount & Currency Validation**: Số tiền chuyển đổi thành chuỗi số nguyên dương VND thuần túy; loại trừ hoàn toàn lỗi số thực dấu phẩy động (float), NaN, số âm hoặc tràn số.
- **Chống trùng & Ambiguity Quarantine**: Dedupe nguồn theo `UNIQUE(gmail_message_id)`. Nếu phát hiện giao dịch có cùng fingerprint (số tiền, mô tả, thời gian) từ email khác, hệ thống tự động đưa vào diện nghi vấn (`QUARANTINE`) để đối soát thay vì âm thầm bỏ sót hoặc nạp tiền 2 lần.
- **Atomic Outbox Pattern**: Lưu thông tin email nguồn, transaction, bank event và các delivery task trong **cùng 1 transaction SQLite duy nhất**.
- **AES-256-GCM Secret Encryption**: Webhook secret của consumer được mã hóa bằng khóa chủ (`APP_MASTER_KEY`) với AAD (gắn liền ID endpoint). Không lưu plaintext secret vào DB hay log.
- **SSRF Guard & Anti-DNS-Rebinding**: Chỉ cho phép webhook qua giao thức HTTPS công khai; chặn toàn bộ loopback (`127.0.0.0/8`, `::1`), private IP (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local/cloud metadata (`169.254.169.254`), CGNAT (`100.64.0.0/10`), IPv4-mapped IPv6. Kiểm tra lại DNS trên mỗi lần retry.
- **Durable Webhook Delivery**: Worker chạy độc lập, lease-locking, exponential backoff + jitter, hỗ trợ `Retry-After`, tự động chuyển sang `DEAD_LETTER` khi vượt ngưỡng retry tối đa (48h).

---

## 3. Webhook Contract

### Headers gửi đi:
```http
POST /your-webhook-endpoint HTTP/1.1
Host: api.yourdomain.com
Content-Type: application/json
User-Agent: bank-event-gateway/1.0
X-Webhook-Id: evt_67b8a1c2...
X-Webhook-Timestamp: 1773240000
X-Webhook-Key-Id: v1
X-Webhook-Signature: v1=4f3110fd41ae877bd3fb0437881971f458f2ddbf...
```

### Payload JSON (`bank.credit.received`):
```json
{
  "schemaVersion": 1,
  "id": "evt_67b8a1c2-901a-4f81-a901-b3b0d1e2f3a4",
  "type": "bank.credit.received",
  "occurredAt": "2026-09-09T08:30:00.000Z",
  "observedAt": "2026-09-09T08:30:05.123Z",
  "source": "gmail",
  "bank": "ACB",
  "transaction": {
    "id": "txn_89c7d1e0-1234-4567-89ab-cdef01234567",
    "direction": "CREDIT",
    "amount": "500000",
    "currency": "VND",
    "accountMasked": "123***789",
    "description": "NGUYEN VAN A chuyen tien don hang REF987654",
    "transactionAt": "2026-09-09T08:30:00.000Z",
    "reference": "987654"
  }
}
```

---

## 4. Hướng dẫn Consumer xác thực Webhook

Consumer backend có thể xác thực webhook bằng tiện ích `verifyIncomingWebhook` (có sẵn trong file `src/webhook/receiver.ts`):

```typescript
import { verifyIncomingWebhook } from './receiver.js';

// Trong router xử lý Webhook (Fastify / Express / Next.js)
app.post('/api/webhooks/bank', async (req, res) => {
  const result = verifyIncomingWebhook({
    rawBody: req.rawBody, // Chuỗi hoặc Buffer raw body nguyên bản
    headers: req.headers,
    secret: process.env.WEBHOOK_SECRET!,
    toleranceSeconds: 300, // Cửa sổ chống replay attack 5 phút
  });

  if (!result.valid) {
    return res.status(401).send({ error: result.error });
  }

  const { payload } = result;
  
  // Xử lý nạp tiền / đối soát dựa trên payload.id (idempotency key)
  await processPaymentIdempotently(payload.id, payload.transaction);

  return res.status(200).send({ received: true });
});
```

---

## 5. Giao diện Web Quản trị (Dashboard) & Cloudflare Access

Hệ thống tích hợp sẵn giao diện Web Quản trị (Dashboard) hiện đại, bảo mật cao qua **Cloudflare Zero Trust**:

- **Domain Quản trị**: [https://bank.tuannguyenviet.site](https://bank.tuannguyenviet.site)
- **Cơ chế xác thực bảo mật**:
  - Tự động xác thực JWT qua Cloudflare Access Assertion cho email quản trị (`nguyenviettuanbp@gmail.com`).
  - Hỗ trợ Cloudflare Access API Key (được cấu hình trong biến môi trường `CLOUDFLARE_ACCESS_API_KEY`).
  - Hỗ trợ nhập trực tiếp trên giao diện hoặc qua Header `cf-access-api-key` (viết thường toàn bộ chữ `c`).

### Các tính năng trên giao diện:
1. **Tổng quan (Overview)**: Trạng thái Server, Uptime, Memory, SQLite WAL, Hàng đợi Delivery và Danh sách các sự kiện tiền vào ACB gần đây.
2. **Quản lý Webhook (Endpoints)**: Đăng ký Webhook mới với URL HTTPS và Secret Key, Bật/Tắt Endpoint, và gửi **Test Ping** trực tiếp từ trình duyệt.
3. **Cấu hình Gmail (Client Helper)**: Dán credentials JSON, tạo link đăng nhập Google OAuth, dán mã Authorization Code để tự động lưu Token và kết nối Gmail mà không cần SSH vào VPS.
4. **Lịch sử Gửi (Deliveries & Replay)**: Xem chi tiết lỗi các đợt phát Webhook và nút **Replay (Gửi lại)** tiện lợi.

---

## 6. Cài đặt và Vận hành CLI

### Cài đặt dependencies:
```bash
npm install
npm run build
```

### Chạy migrations:
```bash
npm run cli migrate
```

### Khởi tạo token Gmail OAuth:
```bash
npm run cli bootstrap-token
```

### Đăng ký Webhook Endpoint cho Consumer:
```bash
npm run cli endpoint add "Messenger Core" "https://api.yourdomain.com/webhooks/bank" "your_super_secret_webhook_key"
```

### Danh sách các Webhook Endpoints:
```bash
npm run cli endpoint list
```

### Sao lưu Database SQLite (Online Non-blocking Backup):
```bash
npm run cli backup ./data/backup-$(date +%Y%m%d).db
```

---

## 6. Triển khai Tự động lên VPS (CI/CD GitHub Actions)

Pipeline tự động triển khai được cấu hình tại `.github/workflows/deploy.yml`:
- Khi có **push hoặc merge vào nhánh `main`**:
  1. Kiểm tra TypeCheck (`npm run lint`) và chạy toàn bộ Unit + Integration Tests (`npm test`).
  2. Build Docker multi-stage image và publish lên GitHub Container Registry (`ghcr.io`).
  3. Kết nối SSH an toàn tới VPS (sử dụng Host Key Verification `known_hosts`).
  4. Thực thi kịch bản `deploy/deploy.sh` trên VPS với cơ chế **flock** (chống chạy đè), tự động sao lưu SQLite database, chạy migration, cập nhật container non-root, kiểm tra readiness qua `/ready` và tự động rollback nếu container không đạt trạng thái khỏe mạnh.

### Các GitHub Secrets cần cấu hình trên Repository:
| Secret Name | Mô tả |
| :--- | :--- |
| `VPS_HOST` | Địa chỉ IP hoặc tên miền của VPS |
| `VPS_PORT` | Cổng SSH của VPS (mặc định: `22`) |
| `VPS_USER` | Tên user deploy trên VPS (ví dụ: `deploy-gateway`) |
| `VPS_SSH_KEY` | SSH Private Key (Ed25519) để đăng nhập VPS |
| `VPS_KNOWN_HOSTS` | Dòng known_hosts của VPS để chống giả mạo MITM |
| `DEPLOY_PATH` | Đường dẫn triển khai trên VPS (ví dụ: `/opt/bank-event-gateway`) |
