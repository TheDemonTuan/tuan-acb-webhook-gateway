# TuanBankGateway v2

ACB ONE Web monitor and signed bank-event webhook gateway.

> **Status:** PR 0 foundation. The legacy Gmail/email implementation is being replaced. This repository does not yet poll ACB or accept production authentication. Do not deploy it for financial monitoring until the protocol and browser handoff gates described in `PLAN_ACB_WEB_MONITOR_SERVICE_PRODUCTION.md` have passed.

## Architecture

- **Go 1.27.1:** gateway HTTP API, SQLite WAL foundation, crypto, migrations, and future monitor/webhook/browser-controller logic.
- **Bun 1.4.2:** frontend package manager, build and tests only.
- **React + Vite:** dashboard static bundle embedded in the Go gateway binary.
- **SQLite WAL:** one local gateway process protected by a file lock.

## Local foundation check

```bash
export PATH="$HOME/.local/go-1.27.1/bin:$PATH"
cd web && bun install && bun run build && bun run test && cd ..
go test ./...
DATA_DIR=/tmp/tuan-bank-gateway LISTEN_ADDR=127.0.0.1:8080 go run ./cmd/gateway
```

Then check:

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/api/v1/status
```

## Safety

- Do not put ACB password, OTP, CAPTCHA, cookies, session fields or raw bank pages into source control, logs, screenshots, or test fixtures.
- The default server binding is loopback. Production administration must be protected by Cloudflare Access before public routing is enabled.
- One local SQLite volume supports one gateway process only. Backups and restoration drills are required before production.

## Next gates

1. Verify the pinned Bun/Go toolchains and browser sandbox on the target VPS.
2. Perform an authorized, manual ACB login proof of concept.
3. Prove browser-to-Go session handoff, dynamic request state, pagination and reconciliation before enabling polling.
4. Add the remaining authenticated API, monitor, webhook and browser-controller phases with their security tests.
