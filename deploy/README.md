# Production operation baseline

This directory contains the Go/Bun v2 deployment baseline. The ACB browser sidecar is deliberately not deployed yet: PR 0 must first prove the authorized browser session handoff and Chromium sandbox on the exact VPS.

## Before deployment

1. Create a non-root `deploy` user and a directory owned by it.
2. Copy `../.env.example` to `.env.production` and set Cloudflare Access values.
3. Create `secrets/app_master_key` with one base64-raw 32-byte random key and `chmod 600` it.
4. Join the shared edge ingress (`/opt/edge`) via the internal `edge-acb` network and configure Cloudflare Access. Do not expose `/metrics`, the private browser RPC, VNC, or CDP to the public.
5. Apply host egress firewall controls before enabling future ACB browser automation. Docker bridge alone is not an egress allowlist.
6. Use a local SSD-backed volume and configure encrypted off-VPS backups plus a restore drill.

## Deploy immutable images

```bash
cd deploy
./deploy.sh \
  ghcr.io/owner/acb-transaction-webhook@sha256:<gateway-digest> \
  ghcr.io/owner/acb-transaction-webhook-auth-browser@sha256:<browser-digest> \
  ghcr.io/owner/acb-transaction-webhook-tts-gateway@sha256:<tts-digest>
```

The image workflow publishes tags; resolve immutable digests before deploying. Do not deploy `latest`. `deploy.sh` automatically provisions `secrets/app_master_key`, `secrets/tts_internal_token`, and Bark Basic Auth secrets (`secrets/bark_basic_auth_user`, `secrets/bark_basic_auth_password`) with UID 1000 compatibility if they do not already exist.

## Bark Notification Service (iOS Push)

Bark runs as a self-hosted notification provider in `acb-bark` container on the private Docker network (`http://bark:8080`).

- **Internal access only**: The gateway contacts Bark over Docker private DNS. Bark port 8080 is NOT published to the host or public internet directly.
- **Onboarding via Cloudflare Tunnel**: Route a dedicated hostname (e.g. `bark.tuannguyenviet.site`) through Cloudflare Tunnel to `http://acb-bark:8080`. Keep `/ping`, `/healthz`, `/register` accessible for iPhone registration, while `/push` is protected by Basic Auth.
- **Encryption at rest**: Bark device keys are encrypted with AES-256-GCM using the gateway master key and never exposed via API or logs.
- **Smoke test**:
  ```bash
  BARK_HOST=127.0.0.1 BARK_PORT=8080 BARK_USER=admin BARK_PASS=... ./deploy/smoke-test-bark.sh
  ```

## Health

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/readyz
```

`AUTH_REQUIRED` must not become a container health failure when monitor functionality is added; it requires an OWNER to complete ACB authentication.

## Backup and rollback

The supplied `backup.sh` refuses to copy an open SQLite WAL database. It is a deliberate guard until the Go online-backup implementation and restore tests land. `rollback.sh` only accepts a recorded v2 immutable image; destructive database migrations require restore of the paired pre-deployment database and key snapshot.
