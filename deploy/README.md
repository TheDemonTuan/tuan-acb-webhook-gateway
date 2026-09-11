# Production operation baseline

This directory contains the Go/Bun v2 deployment baseline. The ACB browser sidecar is deliberately not deployed yet: PR 0 must first prove the authorized browser session handoff and Chromium sandbox on the exact VPS.

## Before deployment

1. Create a non-root `deploy` user and a directory owned by it.
2. Copy `../.env.example` to `.env.production` and set Cloudflare Access values.
3. Create `secrets/app_master_key` with one base64-raw 32-byte random key and `chmod 600` it.
4. Join the shared edge ingress (`/opt/edge`) via the internal `edge-acb` network and configure Cloudflare Access. Do not expose `/metrics`, the private browser RPC, VNC, or CDP to the public.
5. Apply host egress firewall controls before enabling future ACB browser automation. Docker bridge alone is not an egress allowlist.
6. Use a local SSD-backed volume and configure encrypted off-VPS backups plus a restore drill.

## Deploy an immutable image

```bash
cd deploy
./deploy.sh ghcr.io/owner/acb-transaction-webhook@sha256:<64-hex-digest>
```

The image workflow publishes a tag; resolve its immutable digest before deploying. Do not deploy `latest`.

## Health

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/readyz
```

`AUTH_REQUIRED` must not become a container health failure when monitor functionality is added; it requires an OWNER to complete ACB authentication.

## Backup and rollback

The supplied `backup.sh` refuses to copy an open SQLite WAL database. It is a deliberate guard until the Go online-backup implementation and restore tests land. `rollback.sh` only accepts a recorded v2 immutable image; destructive database migrations require restore of the paired pre-deployment database and key snapshot.
