# Multi-stage Dockerfile for Standalone Bank Event Gateway
# Hardened, non-root, minimal attack surface

# --- Stage 1: Builder ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install native compilation dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ gcc libc-dev

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build
RUN npm prune --omit=dev

# --- Stage 2: Production Runner ---
FROM node:22-alpine AS runner

WORKDIR /app

# Install dumb-init for proper signal handling and wget for healthchecks
RUN apk add --no-cache dumb-init wget

ENV NODE_ENV=production \
    PORT=8090 \
    HOST=127.0.0.1 \
    DATABASE_PATH=/app/data/gateway.db \
    GMAIL_CREDENTIALS_PATH=/app/credentials/gmail-credentials.json \
    GMAIL_TOKEN_PATH=/app/credentials/gmail-token.json

# Copy production artifacts from builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create writable data directory and credentials directory with non-root ownership
RUN mkdir -p /app/data /app/credentials && \
    chown -R 1000:1000 /app

# Run as non-root user (node is UID/GID 1000 in alpine)
USER 1000:1000

VOLUME ["/app/data"]
EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/health > /dev/null || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
