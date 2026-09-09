export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bank Event Gateway — ACB Webhook Dashboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2310B981'><path d='M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'/></svg>">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: {
              50: '#ecfdf5',
              500: '#10b981',
              600: '#059669',
              700: '#047857',
              800: '#065f46',
              900: '#064e3b',
            }
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col">

  <!-- TOP HEADER -->
  <header class="border-b border-slate-800 bg-slate-900/70 backdrop-blur sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <span class="font-bold text-lg tracking-tight text-white">Bank Event Gateway</span>
          <span class="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 font-mono">ACB Email • HMAC</span>
        </div>
      </div>

      <div class="flex items-center space-x-3 text-sm">
        <div id="connection-indicator" class="flex items-center space-x-2 text-xs bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span id="gateway-status" class="text-slate-300">Đang kết nối...</span>
        </div>

        <button id="logout-btn" onclick="handleLogout()" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition">
          Đăng xuất
        </button>
      </div>
    </div>

    <!-- NAVIGATION TABS -->
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-1 sm:space-x-4 border-t border-slate-800/60 overflow-x-auto">
      <button onclick="switchTab('overview')" id="tab-btn-overview" class="tab-btn px-4 py-3 text-sm font-medium border-b-2 border-emerald-400 text-emerald-400">
        Tổng quan & Sự kiện
      </button>
      <button onclick="switchTab('endpoints')" id="tab-btn-endpoints" class="tab-btn px-4 py-3 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200">
        Webhook Endpoints
      </button>
      <button onclick="switchTab('gmail')" id="tab-btn-gmail" class="tab-btn px-4 py-3 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center">
        Cấu hình Gmail
        <span id="gmail-badge" class="ml-2 w-2 h-2 rounded-full bg-amber-400"></span>
      </button>
      <button onclick="switchTab('deliveries')" id="tab-btn-deliveries" class="tab-btn px-4 py-3 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200">
        Lịch sử Webhook
      </button>
      <button onclick="switchTab('security')" id="tab-btn-security" class="tab-btn px-4 py-3 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200">
        Bảo mật Cloudflare
      </button>
    </div>
  </header>

  <!-- MAIN CONTAINER -->
  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">

    <!-- TAB 1: OVERVIEW -->
    <div id="tab-overview" class="tab-content space-y-6">
      <!-- STATS METRICS -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div class="text-xs text-slate-400 font-medium uppercase tracking-wider">Trạng thái Database</div>
          <div class="mt-2 text-xl font-bold text-emerald-400 flex items-center space-x-2">
            <span>SQLite WAL</span>
            <span class="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">Khỏe mạnh</span>
          </div>
          <div class="mt-1 text-xs text-slate-500" id="stat-db-path">gateway.db</div>
        </div>

        <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div class="text-xs text-slate-400 font-medium uppercase tracking-wider">Hàng đợi Outbox</div>
          <div class="mt-2 text-xl font-bold text-white flex items-center space-x-2">
            <span id="stat-queue-delivered" class="text-emerald-400">0</span>
            <span class="text-xs text-slate-400">đã gửi</span>
          </div>
          <div class="mt-1 text-xs text-slate-400 flex space-x-2">
            <span>Chờ: <b id="stat-queue-pending" class="text-amber-400">0</b></span>
            <span>•</span>
            <span>Lỗi: <b id="stat-queue-dead" class="text-rose-400">0</b></span>
          </div>
        </div>

        <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div class="text-xs text-slate-400 font-medium uppercase tracking-wider">Gmail Ingestion</div>
          <div class="mt-2 text-xl font-bold text-white" id="stat-gmail-status">Đang tải...</div>
          <div class="mt-1 text-xs text-slate-500 mono truncate" id="stat-history-id">History: --</div>
        </div>

        <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div class="text-xs text-slate-400 font-medium uppercase tracking-wider">Active Webhooks</div>
          <div class="mt-2 text-xl font-bold text-cyan-400" id="stat-endpoints-count">0</div>
          <div class="mt-1 text-xs text-slate-500" id="stat-uptime">Uptime: 0s</div>
        </div>
      </div>

      <!-- RECENT EVENTS TABLE -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div class="px-5 py-4 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h3 class="font-semibold text-white">Biến động số dư ACB gần đây (Báo Có)</h3>
            <p class="text-xs text-slate-400 mt-0.5">Các sự kiện tiền vào được trích xuất tự động và phát webhook bảo mật</p>
          </div>
          <button onclick="loadOverviewData()" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition flex items-center space-x-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            <span>Làm mới</span>
          </button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm text-slate-300">
            <thead class="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th class="px-5 py-3">Thời gian</th>
                <th class="px-5 py-3">Số tiền</th>
                <th class="px-5 py-3">Tài khoản</th>
                <th class="px-5 py-3">Nội dung chuyển tiền</th>
                <th class="px-5 py-3">Trạng thái</th>
              </tr>
            </thead>
            <tbody id="events-table-body" class="divide-y divide-slate-800">
              <tr>
                <td colspan="5" class="px-5 py-8 text-center text-slate-500">Chưa có sự kiện biến động nào được ghi nhận.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 2: WEBHOOK ENDPOINTS -->
    <div id="tab-endpoints" class="tab-content hidden space-y-6">
      <div class="flex justify-between items-center">
        <div>
          <h2 class="text-lg font-bold text-white">Quản lý Webhook Destinations</h2>
          <p class="text-xs text-slate-400">Các consumer backend sẽ nhận webhook ký HMAC-SHA256 mỗi khi có biến động tiền vào</p>
        </div>
        <button onclick="openAddEndpointModal()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 py-2 rounded-lg shadow transition flex items-center space-x-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          <span>Đăng ký Webhook Mới</span>
        </button>
      </div>

      <div class="grid grid-cols-1 gap-4" id="endpoints-list">
        <!-- Endpoints populated dynamically -->
      </div>
    </div>

    <!-- TAB 3: GMAIL CONFIGURATION CLIENT -->
    <div id="tab-gmail" class="tab-content hidden space-y-6">
      <div>
        <h2 class="text-lg font-bold text-white">Thiết lập kết nối Gmail (Client Helper)</h2>
        <p class="text-xs text-slate-400">Cấu hình OAuth2 và Google Cloud Pub/Sub trực tiếp trên giao diện — không cần thao tác VPS thủ công</p>
      </div>

      <!-- STATUS CARDS -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div class="flex items-center justify-between">
            <h4 class="font-semibold text-white text-sm">1. OAuth Credentials (Client ID & Secret)</h4>
            <span id="badge-creds-status" class="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-400">Kiểm tra...</span>
          </div>
          <p class="text-xs text-slate-400 mt-2 leading-relaxed">
            Tải file OAuth Client Credentials từ Google Cloud Console (Desktop/Web application) và dán nội dung vào đây.
          </p>
          <div class="mt-4">
            <textarea id="gmail-creds-input" rows="4" placeholder='Dán toàn bộ nội dung JSON client credentials ({"installed":{"client_id":"...","client_secret":"..."}})' class="w-full text-xs mono bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 focus:outline-none focus:border-emerald-500"></textarea>
            <div class="mt-3 flex justify-end">
              <button onclick="saveGmailCredentials()" class="bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-800/60 font-medium text-xs px-4 py-2 rounded-lg transition">
                Lưu OAuth Credentials
              </button>
            </div>
          </div>
        </div>

        <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div class="flex items-center justify-between">
            <h4 class="font-semibold text-white text-sm">2. Google Account Authorization (Token)</h4>
            <span id="badge-token-status" class="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-400">Kiểm tra...</span>
          </div>
          <p class="text-xs text-slate-400 mt-2 leading-relaxed">
            Đăng nhập tài khoản Gmail nhận thông báo ACB và cấp quyền chỉ đọc hộp thư (<code class="mono text-emerald-400">gmail.readonly</code>).
          </p>
          <div class="mt-4 space-y-3">
            <button onclick="getGoogleAuthUrl()" class="w-full bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 font-medium text-xs px-4 py-2.5 rounded-lg transition flex items-center justify-center space-x-2">
              <svg class="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
              <span>Lấy Link Đăng Nhập Google OAuth</span>
            </button>

            <div id="oauth-code-section" class="hidden space-y-2 pt-2 border-t border-slate-800">
              <label class="text-xs text-slate-300">Nhập Authorization Code nhận được từ Google:</label>
              <input type="text" id="oauth-code-input" placeholder="4/0AX4Xf..." class="w-full text-xs mono bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 focus:outline-none focus:border-emerald-500">
              <button onclick="submitAuthCode()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 py-2 rounded-lg transition">
                Xác Nhận & Lưu Token
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- PUB/SUB & ACTIONS -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <h4 class="font-semibold text-white text-sm">3. Đồng bộ & Kích hoạt Push Notification</h4>
        <div class="flex flex-wrap gap-3">
          <button onclick="triggerSyncNow()" class="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 text-xs px-4 py-2.5 rounded-lg transition flex items-center space-x-2">
            <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            <span>Đồng bộ Gmail ngay (Reconcile History)</span>
          </button>

          <button onclick="triggerRenewWatch()" class="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 text-xs px-4 py-2.5 rounded-lg transition flex items-center space-x-2">
            <svg class="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
            <span>Gia hạn Pub/Sub Watch (users.watch)</span>
          </button>
        </div>
      </div>
    </div>

    <!-- TAB 4: DELIVERIES -->
    <div id="tab-deliveries" class="tab-content hidden space-y-6">
      <div class="flex justify-between items-center">
        <div>
          <h2 class="text-lg font-bold text-white">Lịch sử phát Webhook (Durable Outbox)</h2>
          <p class="text-xs text-slate-400">Theo dõi trạng thái gửi webhook, số lần thử lại, và gửi lại (Replay) thủ công nếu có lỗi</p>
        </div>
        <button onclick="loadDeliveriesData()" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition">
          Làm mới
        </button>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm text-slate-300">
            <thead class="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th class="px-5 py-3">Thời gian</th>
                <th class="px-5 py-3">Destination</th>
                <th class="px-5 py-3">Trạng thái</th>
                <th class="px-5 py-3">HTTP Code</th>
                <th class="px-5 py-3">Số lần thử</th>
                <th class="px-5 py-3">Lỗi gần nhất</th>
                <th class="px-5 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody id="deliveries-table-body" class="divide-y divide-slate-800">
              <tr>
                <td colspan="7" class="px-5 py-8 text-center text-slate-500">Chưa có bản ghi delivery nào.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 5: SECURITY & CLOUDFLARE -->
    <div id="tab-security" class="tab-content hidden space-y-6">
      <div>
        <h2 class="text-lg font-bold text-white">Bảo mật & Cloudflare Access</h2>
        <p class="text-xs text-slate-400">Thông tin xác thực và thiết lập Zero Trust cho Gateway</p>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div class="space-y-1">
          <div class="text-xs text-slate-400 uppercase font-medium">Cloudflare Access Domain</div>
          <div class="text-sm font-semibold text-emerald-400 mono">https://bank.tuannguyenviet.site</div>
        </div>

          <div class="space-y-1 pt-3 border-t border-slate-800">
          <div class="text-xs text-slate-400 uppercase font-medium">Cloudflare Access API Key (Token)</div>
          <p class="text-xs text-slate-400">Header: <code class="mono text-emerald-400">cf-access-api-key: [CLOUDFLARE_ACCESS_API_KEY]</code> (viết thường toàn bộ chữ c)</p>
        </div>

        <div class="space-y-1 pt-3 border-t border-slate-800">
          <div class="text-xs text-slate-400 uppercase font-medium">Cloudflare Access AUD</div>
          <div class="text-xs mono text-slate-400">546ad6f298f280ba4cc513c26558d7dadc9db37cd37926fc2a6afdcbe626b4e3</div>
        </div>
      </div>
    </div>

  </main>

  <!-- MODAL: ADD ENDPOINT -->
  <div id="modal-add-endpoint" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl">
      <div class="flex justify-between items-center">
        <h3 class="text-base font-bold text-white">Đăng ký Webhook Destination Mới</h3>
        <button onclick="closeAddEndpointModal()" class="text-slate-400 hover:text-slate-200">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block text-slate-300 mb-1 font-medium">Tên gọi Destination (gợi nhớ)</label>
          <input type="text" id="new-ep-name" placeholder="Ví dụ: Facebook Messenger Bot AI / Core Backend" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500">
        </div>

        <div>
          <label class="block text-slate-300 mb-1 font-medium">URL Webhook (Bắt buộc HTTPS công khai)</label>
          <input type="url" id="new-ep-url" placeholder="https://api.domain-cua-ban.com/webhook" class="w-full mono bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500">
          <p class="text-[11px] text-slate-500 mt-1">Hệ thống có SSRF Guard tự động chặn các địa chỉ IP nội bộ, loopback hoặc private IP.</p>
        </div>

        <div>
          <div class="flex justify-between items-center mb-1">
            <label class="text-slate-300 font-medium">Shared Secret Key (HMAC-SHA256)</label>
            <button onclick="generateRandomSecret()" class="text-emerald-400 hover:underline text-[11px]">Tạo ngẫu nhiên</button>
          </div>
          <input type="text" id="new-ep-secret" placeholder="whsec_..." class="w-full mono bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500">
          <p class="text-[11px] text-slate-500 mt-1">Secret được mã hóa AES-256-GCM an toàn trước khi lưu vào SQLite database.</p>
        </div>
      </div>

      <div class="flex justify-end space-x-2 pt-2 border-t border-slate-800">
        <button onclick="closeAddEndpointModal()" class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition">Hủy</button>
        <button onclick="submitAddEndpoint()" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition">Lưu & Kích hoạt</button>
      </div>
    </div>
  </div>

  <!-- MODAL: LOGIN / AUTH KEY -->
  <div id="modal-auth-key" class="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-50 hidden flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl text-center">
      <div class="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 mx-auto flex items-center justify-center text-emerald-400">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
      </div>
      <div>
        <h3 class="text-lg font-bold text-white">Yêu cầu xác thực Gateway</h3>
        <p class="text-xs text-slate-400 mt-1">Nhập Cloudflare Access API Key để mở khóa quyền quản trị</p>
      </div>
      <div class="space-y-3 text-left">
        <input type="password" id="auth-key-input" placeholder="cfut_..." class="w-full mono text-xs bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-200 focus:outline-none focus:border-emerald-500">
        <button onclick="submitAuthKey()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs py-2.5 rounded-lg transition shadow-md">
          Mở khóa Dashboard
        </button>
      </div>
      <div class="pt-2 text-[11px] text-slate-500">
        Bảo mật Cloudflare Zero Trust • Không viết hoa chữ c
      </div>
    </div>
  </div>

  <!-- TOAST NOTIFICATION -->
  <div id="toast" class="fixed bottom-5 right-5 z-50 bg-slate-800 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-xl shadow-lg text-xs transition transform translate-y-16 opacity-0 flex items-center space-x-2">
    <span id="toast-message">Thông báo</span>
  </div>

  <script>
    // State
    const AUTH_KEY_STORAGE = 'bank_gateway_cf_key';
    let currentAuthKey = localStorage.getItem(AUTH_KEY_STORAGE) || '';

    function getHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      if (currentAuthKey) {
        headers['cf-access-api-key'] = currentAuthKey;
      }
      return headers;
    }

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      const text = document.getElementById('toast-message');
      text.innerText = msg;
      toast.className = isError 
        ? 'fixed bottom-5 right-5 z-50 bg-rose-950 border border-rose-800 text-rose-200 px-4 py-2.5 rounded-xl shadow-lg text-xs transition duration-300 flex items-center space-x-2'
        : 'fixed bottom-5 right-5 z-50 bg-slate-800 border border-emerald-700/80 text-emerald-300 px-4 py-2.5 rounded-xl shadow-lg text-xs transition duration-300 flex items-center space-x-2';
      toast.classList.remove('translate-y-16', 'opacity-0');
      setTimeout(() => {
        toast.classList.add('translate-y-16', 'opacity-0');
      }, 3500);
    }

    function switchTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('border-emerald-400', 'text-emerald-400');
        btn.classList.add('border-transparent', 'text-slate-400');
      });

      const activeTab = document.getElementById('tab-' + tabId);
      const activeBtn = document.getElementById('tab-btn-' + tabId);
      if (activeTab && activeBtn) {
        activeTab.classList.remove('hidden');
        activeBtn.classList.add('border-emerald-400', 'text-emerald-400');
        activeBtn.classList.remove('border-transparent', 'text-slate-400');
      }

      if (tabId === 'overview') loadOverviewData();
      if (tabId === 'endpoints') loadEndpointsData();
      if (tabId === 'gmail') loadGmailData();
      if (tabId === 'deliveries') loadDeliveriesData();
    }

    async function apiFetch(url, options = {}) {
      options.headers = { ...getHeaders(), ...(options.headers || {}) };
      try {
        const res = await fetch(url, options);
        if (res.status === 401) {
          document.getElementById('modal-auth-key').classList.remove('hidden');
          throw new Error('Yêu cầu xác thực API Key');
        }
        return res;
      } catch (err) {
        throw err;
      }
    }

    function submitAuthKey() {
      const input = document.getElementById('auth-key-input').value.trim();
      if (!input) return;
      currentAuthKey = input;
      localStorage.setItem(AUTH_KEY_STORAGE, input);
      document.cookie = 'cf_access_token=' + encodeURIComponent(input) + '; path=/; max-age=2592000; SameSite=Lax';
      document.getElementById('modal-auth-key').classList.add('hidden');
      initDashboard();
    }

    function handleLogout() {
      localStorage.removeItem(AUTH_KEY_STORAGE);
      document.cookie = 'cf_access_token=; path=/; max-age=0';
      currentAuthKey = '';
      document.getElementById('modal-auth-key').classList.remove('hidden');
    }

    function toggleKeyVisibility() {
      const input = document.getElementById('cf-api-key-display');
      input.type = input.type === 'password' ? 'text' : 'password';
    }

    // OVERVIEW
    async function loadOverviewData() {
      try {
        const res = await apiFetch('/api/status');
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('gateway-status').innerText = 'Hệ thống: Khỏe mạnh';
        document.getElementById('stat-queue-delivered').innerText = data.queue.delivered || 0;
        document.getElementById('stat-queue-pending').innerText = data.queue.pending || 0;
        document.getElementById('stat-queue-dead').innerText = data.queue.deadLetter || 0;
        document.getElementById('stat-endpoints-count').innerText = data.activeEndpointsCount || 0;
        document.getElementById('stat-uptime').innerText = 'Uptime: ' + formatUptime(data.uptimeSeconds);

        const gmailBadge = document.getElementById('gmail-badge');
        if (data.gmailAuth.hasToken && data.gmailAuth.hasCredentials) {
          document.getElementById('stat-gmail-status').innerText = 'Đã kết nối';
          document.getElementById('stat-gmail-status').className = 'mt-2 text-xl font-bold text-emerald-400';
          gmailBadge.className = 'ml-2 w-2 h-2 rounded-full bg-emerald-400';
        } else {
          document.getElementById('stat-gmail-status').innerText = 'Chưa cấu hình';
          document.getElementById('stat-gmail-status').className = 'mt-2 text-xl font-bold text-amber-400';
          gmailBadge.className = 'ml-2 w-2 h-2 rounded-full bg-amber-400 animate-ping';
        }

        if (data.gmailSync.lastHistoryId) {
          document.getElementById('stat-history-id').innerText = 'History: ' + data.gmailSync.lastHistoryId;
        }

        loadRecentEvents();
      } catch (err) {
        console.error('loadOverviewData error:', err);
      }
    }

    async function loadRecentEvents() {
      try {
        const res = await apiFetch('/api/events');
        if (!res.ok) return;
        const events = await res.json();
        const tbody = document.getElementById('events-table-body');
        if (!events || events.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-8 text-center text-slate-500">Chưa có sự kiện biến động nào được ghi nhận.</td></tr>';
          return;
        }

        tbody.innerHTML = events.map(e => \`
          <tr class="hover:bg-slate-800/40 transition">
            <td class="px-5 py-3.5 text-xs text-slate-400 mono">\${formatDate(e.transactionAt || e.createdAt)}</td>
            <td class="px-5 py-3.5 font-bold text-emerald-400 mono text-sm">+\${formatCurrency(e.amount)} VND</td>
            <td class="px-5 py-3.5 mono text-xs text-slate-300">\${e.accountMasked}</td>
            <td class="px-5 py-3.5 text-xs text-slate-300 max-w-xs truncate" title="\${escapeHtml(e.description || '')}">\${escapeHtml(e.description || '-')}</td>
            <td class="px-5 py-3.5">
              <span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-medium">Báo Có</span>
            </td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('loadRecentEvents error:', err);
      }
    }

    // ENDPOINTS
    async function loadEndpointsData() {
      try {
        const res = await apiFetch('/api/endpoints');
        if (!res.ok) return;
        const endpoints = await res.json();
        const container = document.getElementById('endpoints-list');

        if (!endpoints || endpoints.length === 0) {
          container.innerHTML = \`
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-3">
              <div class="w-10 h-10 rounded-full bg-slate-800 text-slate-500 mx-auto flex items-center justify-center">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              </div>
              <p class="text-sm text-slate-400">Chưa có Webhook Endpoint nào được đăng ký.</p>
              <button onclick="openAddEndpointModal()" class="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition">
                + Thêm Endpoint Ngay
              </button>
            </div>
          \`;
          return;
        }

        container.innerHTML = endpoints.map(ep => \`
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div class="space-y-1">
              <div class="flex items-center space-x-2">
                <span class="font-bold text-white text-sm">\${escapeHtml(ep.name)}</span>
                <span class="text-[11px] px-2 py-0.5 rounded-full \${ep.enabled ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-500 border border-slate-700'}">
                  \${ep.enabled ? 'Đang hoạt động' : 'Tạm dừng'}
                </span>
              </div>
              <div class="mono text-xs text-emerald-400/90 break-all">\${escapeHtml(ep.url)}</div>
              <div class="text-[11px] text-slate-500">Timeout: \${ep.timeoutMs}ms • Key Version: \${ep.keyVersion} • Tạo ngày: \${formatDate(ep.createdAt)}</div>
            </div>

            <div class="flex items-center space-x-2 shrink-0">
              <button onclick="testWebhookEndpoint('\${ep.id}')" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition">
                Test Ping
              </button>
              <button onclick="toggleEndpoint('\${ep.id}', \${!ep.enabled})" class="text-xs \${ep.enabled ? 'bg-amber-950/40 text-amber-400 border-amber-800/60' : 'bg-emerald-950/40 text-emerald-400 border-emerald-800/60'} border px-3 py-1.5 rounded-lg transition">
                \${ep.enabled ? 'Tạm dừng' : 'Kích hoạt'}
              </button>
              <button onclick="deleteEndpoint('\${ep.id}')" class="text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-800/60 px-3 py-1.5 rounded-lg transition">
                Xóa
              </button>
            </div>
          </div>
        \`).join('');
      } catch (err) {
        console.error('loadEndpointsData error:', err);
      }
    }

    function openAddEndpointModal() {
      document.getElementById('new-ep-name').value = '';
      document.getElementById('new-ep-url').value = '';
      generateRandomSecret();
      document.getElementById('modal-add-endpoint').classList.remove('hidden');
    }

    function closeAddEndpointModal() {
      document.getElementById('modal-add-endpoint').classList.add('hidden');
    }

    function generateRandomSecret() {
      const rand = Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      document.getElementById('new-ep-secret').value = 'whsec_' + rand;
    }

    async function submitAddEndpoint() {
      const name = document.getElementById('new-ep-name').value.trim();
      const url = document.getElementById('new-ep-url').value.trim();
      const secret = document.getElementById('new-ep-secret').value.trim();

      if (!name || !url || !secret) {
        showToast('Vui lòng điền đầy đủ tên, URL và secret key', true);
        return;
      }

      try {
        const res = await apiFetch('/api/endpoints', {
          method: 'POST',
          body: JSON.stringify({ name, url, secret })
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Lỗi thêm endpoint', true);
          return;
        }
        showToast('Đăng ký webhook thành công!');
        closeAddEndpointModal();
        loadEndpointsData();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function toggleEndpoint(id, enabled) {
      try {
        const res = await apiFetch(\`/api/endpoints/\${id}/toggle\`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled })
        });
        if (res.ok) {
          showToast('Cập nhật trạng thái endpoint thành công');
          loadEndpointsData();
        }
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function deleteEndpoint(id) {
      if (!confirm('Bạn có chắc chắn muốn xóa webhook endpoint này?')) return;
      try {
        const res = await apiFetch(\`/api/endpoints/\${id}\`, { method: 'DELETE' });
        if (res.ok) {
          showToast('Đã xóa webhook endpoint');
          loadEndpointsData();
        }
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function testWebhookEndpoint(id) {
      showToast('Đang gửi test ping webhook...');
      try {
        const res = await apiFetch(\`/api/endpoints/\${id}/test\`, { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast(\`Gửi thành công! Downstream phản hồi HTTP \${data.status}\`);
        } else {
          showToast(\`Test thất bại: \${data.error || 'Không kết nối được'}\`, true);
        }
      } catch (err) {
        showToast(err.message, true);
      }
    }

    // GMAIL
    async function loadGmailData() {
      try {
        const res = await apiFetch('/api/status');
        if (!res.ok) return;
        const data = await res.json();

        const credsBadge = document.getElementById('badge-creds-status');
        if (data.gmailAuth.hasCredentials) {
          credsBadge.innerText = 'Đã nạp file credentials';
          credsBadge.className = 'text-xs px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800';
        } else {
          credsBadge.innerText = 'Chưa có credentials';
          credsBadge.className = 'text-xs px-2.5 py-1 rounded-full bg-rose-950 text-rose-400 border border-rose-800';
        }

        const tokenBadge = document.getElementById('badge-token-status');
        if (data.gmailAuth.hasToken) {
          tokenBadge.innerText = 'Đã đăng nhập OAuth';
          tokenBadge.className = 'text-xs px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800';
        } else {
          tokenBadge.innerText = 'Chưa có Token';
          tokenBadge.className = 'text-xs px-2.5 py-1 rounded-full bg-amber-950 text-amber-400 border border-amber-800';
        }
      } catch (err) {
        console.error('loadGmailData error:', err);
      }
    }

    async function saveGmailCredentials() {
      const raw = document.getElementById('gmail-creds-input').value.trim();
      if (!raw) {
        showToast('Vui lòng dán nội dung credentials JSON', true);
        return;
      }

      try {
        const res = await apiFetch('/api/gmail/credentials', {
          method: 'POST',
          body: JSON.stringify({ credentialsJson: raw })
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Lưu credentials thất bại', true);
          return;
        }
        showToast('Đã lưu OAuth Credentials thành công!');
        document.getElementById('gmail-creds-input').value = '';
        loadGmailData();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function getGoogleAuthUrl() {
      try {
        const res = await apiFetch('/api/gmail/auth-url');
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Chưa thể lấy link đăng nhập', true);
          return;
        }
        window.open(data.authUrl, '_blank');
        document.getElementById('oauth-code-section').classList.remove('hidden');
        showToast('Đã mở trang đăng nhập Google. Hãy đăng nhập và sao chép mã Authorization Code dán vào ô bên dưới.');
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function submitAuthCode() {
      const code = document.getElementById('oauth-code-input').value.trim();
      if (!code) {
        showToast('Vui lòng nhập Authorization Code', true);
        return;
      }

      try {
        showToast('Đang trao đổi mã lấy OAuth Token...');
        const res = await apiFetch('/api/gmail/exchange-code', {
          method: 'POST',
          body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Xác thực code thất bại', true);
          return;
        }
        showToast('Kết nối tài khoản Gmail thành công!');
        document.getElementById('oauth-code-input').value = '';
        document.getElementById('oauth-code-section').classList.add('hidden');
        loadGmailData();
        loadOverviewData();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function triggerSyncNow() {
      showToast('Đang kích hoạt đồng bộ lịch sử Gmail...');
      try {
        const res = await apiFetch('/api/gmail/sync-now', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          showToast(\`Đồng bộ hoàn tất: Đã xử lý \${data.processed} email mới\`);
          loadOverviewData();
        } else {
          showToast(data.error || 'Lỗi đồng bộ', true);
        }
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function triggerRenewWatch() {
      showToast('Đang gửi yêu cầu gia hạn Pub/Sub watch...');
      try {
        const res = await apiFetch('/api/gmail/renew-watch', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          showToast(\`Gia hạn watch thành công! Hết hạn lúc: \${formatDate(data.expiration)}\`);
          loadOverviewData();
        } else {
          showToast(data.error || 'Gia hạn thất bại', true);
        }
      } catch (err) {
        showToast(err.message, true);
      }
    }

    // DELIVERIES
    async function loadDeliveriesData() {
      try {
        const res = await apiFetch('/api/deliveries');
        if (!res.ok) return;
        const list = await res.json();
        const tbody = document.getElementById('deliveries-table-body');
        if (!list || list.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500">Chưa có bản ghi delivery nào.</td></tr>';
          return;
        }

        tbody.innerHTML = list.map(d => \`
          <tr class="hover:bg-slate-800/40 transition text-xs">
            <td class="px-5 py-3.5 text-slate-400 mono">\${formatDate(d.createdAt)}</td>
            <td class="px-5 py-3.5">
              <div class="font-medium text-white">\${escapeHtml(d.endpointName || '')}</div>
              <div class="text-[11px] mono text-slate-500 truncate max-w-xs">\${escapeHtml(d.endpointUrl || '')}</div>
            </td>
            <td class="px-5 py-3.5">
              <span class="px-2 py-0.5 rounded-full font-medium \${
                d.status === 'DELIVERED' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                d.status === 'PENDING' ? 'bg-sky-950 text-sky-400 border border-sky-800' :
                d.status === 'RETRYING' ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                'bg-rose-950 text-rose-400 border border-rose-800'
              }">\${d.status}</span>
            </td>
            <td class="px-5 py-3.5 mono">\${d.lastHttpStatus ? ('HTTP ' + d.lastHttpStatus) : '-'}</td>
            <td class="px-5 py-3.5 mono">\${d.attemptCount}</td>
            <td class="px-5 py-3.5 text-slate-400 max-w-xs truncate text-[11px]" title="\${escapeHtml(d.lastError || '')}">\${escapeHtml(d.lastError || '-')}</td>
            <td class="px-5 py-3.5 text-right">
              \${(d.status === 'DEAD_LETTER' || d.status === 'RETRYING') ? \`
                <button onclick="replayDelivery('\${d.id}')" class="text-xs bg-slate-800 hover:bg-slate-700 text-emerald-400 px-2.5 py-1 rounded border border-slate-700 transition">
                  Gửi lại
                </button>
              \` : '-'}
            </td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('loadDeliveriesData error:', err);
      }
    }

    async function replayDelivery(id) {
      try {
        const res = await apiFetch(\`/api/deliveries/\${id}/replay\`, { method: 'POST' });
        if (res.ok) {
          showToast('Đã lên lịch gửi lại webhook!');
          loadDeliveriesData();
        }
      } catch (err) {
        showToast(err.message, true);
      }
    }

    // UTILITIES
    function formatCurrency(numStr) {
      if (!numStr) return '0';
      return parseInt(numStr, 10).toLocaleString('vi-VN');
    }

    function formatDate(isoStr) {
      if (!isoStr) return '-';
      try {
        const d = new Date(isoStr);
        return d.toLocaleDateString('vi-VN', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      } catch {
        return isoStr;
      }
    }

    function formatUptime(seconds) {
      if (!seconds) return '0s';
      const m = Math.floor(seconds / 60);
      const h = Math.floor(m / 60);
      const d = Math.floor(h / 24);
      if (d > 0) return \`\${d}d \${h % 24}h\`;
      if (h > 0) return \`\${h}h \${m % 60}m\`;
      if (m > 0) return \`\${m}m \${seconds % 60}s\`;
      return \`\${seconds}s\`;
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // INIT
    async function initDashboard() {
      if (!currentAuthKey) {
        document.getElementById('modal-auth-key').classList.remove('hidden');
        return;
      }
      loadOverviewData();
      setInterval(loadOverviewData, 10000); // Auto-refresh metrics every 10s
    }

    document.addEventListener('DOMContentLoaded', initDashboard);
  </script>
</body>
</html>`;
}
