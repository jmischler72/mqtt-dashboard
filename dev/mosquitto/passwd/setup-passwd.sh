#!/bin/bash
# Generates the mosquitto2 password file (testuser / testpass).
# Run this once before starting docker-compose-dev.
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Generating mosquitto2 password file..."
docker run --rm eclipse-mosquitto:2 mosquitto_passwd -b -c - testuser testpass > "$SCRIPT_DIR/passwd"

echo "Done — $SCRIPT_DIR/passwd created."
echo "Credentials: testuser / testpass"
