# syntax=docker/dockerfile:1.7

FROM oven/bun:1.4.2-debian AS web-builder
WORKDIR /src/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bunx --bun tsc --noEmit && bunx --bun vite build

FROM golang:1.27.1-bookworm AS go-builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=web-builder /src/internal/httpui/dist ./internal/httpui/dist
RUN mkdir -p -m 0777 /data
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/gateway ./cmd/gateway && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/auth-browser ./cmd/auth-browser

FROM gcr.io/distroless/static-debian12:nonroot AS gateway
COPY --from=go-builder --chown=1000:1000 /data /data
COPY --from=go-builder /out/gateway /gateway
USER 1000:1000
ENTRYPOINT ["/gateway"]
