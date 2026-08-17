#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Preparing dev environment setup..."

# 1. Clean up invalid directories created by docker-compose mounts if present
if [ -d "$SCRIPT_DIR/mosquitto/passwd/passwd" ]; then
    echo "Cleaning up directory created by Docker at dev/mosquitto/passwd/passwd..."
    rm -rf "$SCRIPT_DIR/mosquitto/passwd/passwd"
fi

# 2. Setup password file if missing or empty
if [ ! -s "$SCRIPT_DIR/mosquitto/passwd/passwd" ]; then
    echo "==> Generating Mosquitto password file (testuser / testpass)..."
    chmod +x "$SCRIPT_DIR/mosquitto/passwd/setup-passwd.sh"
    "$SCRIPT_DIR/mosquitto/passwd/setup-passwd.sh"
fi

if [ -f "$SCRIPT_DIR/mosquitto/passwd/passwd" ]; then
    chmod 0600 "$SCRIPT_DIR/mosquitto/passwd/passwd" || true
fi

# 3. Setup TLS certificates if missing
if [ ! -f "$SCRIPT_DIR/mosquitto/certs/ca.crt" ]; then
    echo "==> Generating dev TLS certificates..."
    chmod +x "$SCRIPT_DIR/mosquitto/certs/generate.sh"
    "$SCRIPT_DIR/mosquitto/certs/generate.sh"
fi

echo "==> Dev environment setup complete!"
