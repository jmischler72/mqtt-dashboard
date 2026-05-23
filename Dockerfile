# Stage 1: Build frontend
FROM node:26-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend (with embedded frontend dist)
FROM golang:1.26-alpine AS backend-builder
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend-builder /frontend/dist ./dist
RUN go build -o mqtt-dashboard .

# Stage 3: Minimal production image
FROM alpine:3.21
LABEL org.opencontainers.image.source="https://github.com/jmischler72/mqtt-dashboard"

RUN apk add --no-cache ca-certificates
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN mkdir -p /app/data

WORKDIR /app

COPY --from=backend-builder /app/mqtt-dashboard .

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 8080
CMD ["./mqtt-dashboard"]
