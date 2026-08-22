#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Preparing dev environment setup..."

# 1. Clean up invalid directories created by docker-compose mounts if present
if [ -d "$SCRIPT_DIR/mosquitto/passwd/passwd" ]; then
    echo "Cleaning up directory created by Docker at docker/dev/mosquitto/passwd/passwd..."
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

# 4. Generate worktree info for frontend in dev
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
MESSAGE=$(git log -1 --pretty=%s 2>/dev/null || echo "")
WORKTREE=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
TARGET_FILE="$(cd "$SCRIPT_DIR/../.." && pwd)/frontend/src/worktreeInfo.json"

node -e '
const fs = require("fs");
const [, target, worktree, branch, commit, message] = process.argv;
fs.writeFileSync(target, JSON.stringify({ worktree, branch, commit, message }, null, 2) + "\n");
' "$TARGET_FILE" "$WORKTREE" "$BRANCH" "$COMMIT" "$MESSAGE" 2>/dev/null || true

echo "==> Dev environment setup complete!"
