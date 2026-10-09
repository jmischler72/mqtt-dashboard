# syntax=docker/dockerfile:1

# Stage 1: Build frontend
FROM node:26-alpine AS frontend-builder
WORKDIR /frontend

COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend (with embedded frontend dist)
FROM golang:1.27-alpine AS backend-builder
WORKDIR /app

COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY backend/ ./
COPY --from=frontend-builder /frontend/dist ./dist

ARG VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -ldflags="-s -w -X main.version=${VERSION}" -trimpath -o mqtt-dashboard .

# Stage 3: Minimal production image
FROM alpine:3.24
LABEL org.opencontainers.image.source="https://github.com/jmischler72/mqtt-dashboard"

# ca-certificates for TLS broker connections; tzdata for cron timezone handling
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -g 1000 -S appgroup && \
    adduser -u 1000 -S appuser -G appgroup && \
    mkdir -p /app/data && \
    chown -R appuser:appgroup /app/data

WORKDIR /app

COPY --chown=appuser:appgroup --from=backend-builder /app/mqtt-dashboard .
COPY --chown=appuser:appgroup docker/dev/dev-seed.json /app/dev-seed.json

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/api/health || exit 1

CMD ["./mqtt-dashboard"]
