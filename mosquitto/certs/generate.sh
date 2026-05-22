#!/bin/bash
# Generates a self-signed CA, server certificate, and client certificate
# for the mosquitto-tls TLS/mTLS dev broker.
#
# Run once before starting docker-compose-dev:
#   chmod +x ./mosquitto/certs/generate.sh
#   ./mosquitto/certs/generate.sh

set -e
cd "$(dirname "$0")"

echo "==> Generating dev TLS certificates for mosquitto-tls..."

# ── CA ─────────────────────────────────────────────────────────────────────────
openssl genrsa -out ca.key 2048
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
  -subj "/CN=MQTT Dashboard Dev CA/O=Dev/C=US"

# ── Server certificate ─────────────────────────────────────────────────────────
# SAN must include the Docker service name so the backend can verify it
# when connecting as mosquitto-tls:8883 from within docker-compose.
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr \
  -subj "/CN=mosquitto-tls/O=Dev/C=US"
cat > server.ext <<'EOF'
subjectAltName=DNS:mosquitto-tls,DNS:localhost,IP:127.0.0.1
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -days 3650 -extfile server.ext

# ── Client certificate (for mTLS testing) ─────────────────────────────────────
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr \
  -subj "/CN=mqtt-dashboard-client/O=Dev/C=US"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out client.crt -days 3650

# Clean up intermediates
rm -f server.csr server.ext client.csr ca.srl

echo ""
echo "Done. Files created in $(pwd):"
echo "  ca.crt        — CA certificate (paste into dashboard 'CA Certificate' field)"
echo "  server.key/crt — Mosquitto TLS server certificate (used by mosquitto)"
echo "  client.key/crt — Client certificate (paste into dashboard for mTLS)"
