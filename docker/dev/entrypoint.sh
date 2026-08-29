#!/bin/sh
# Dev container entrypoint: keep /node_modules in sync with the mounted
# lockfile, then run Vite and air side by side.
set -e

# Nothing masks /node_modules any more, and Node resolves the nearest
# node_modules first — a host-side `npm install` would shadow the container's
# Linux binaries with macOS ones. Fail loudly rather than crash inside Vite.
if [ -n "$(ls -A /app/frontend/node_modules 2>/dev/null)" ]; then
    echo "ERROR: frontend/node_modules exists in the worktree and would shadow" >&2
    echo "       the container's deps in /node_modules. Remove it on the host:" >&2
    echo "         rm -rf frontend/node_modules" >&2
    exit 1
fi

LOCK=/app/frontend/package-lock.json
HASH_FILE=/node_modules/.lock-hash

# The image installs deps at build time, but the worktree is bind-mounted, so a
# branch switch or a pull can bring in a lockfile the image was never built
# against. Reinstall when that happens instead of serving a stale tree (which
# shows up as missing platform binaries, e.g. lightningcss-linux-arm64-musl).
if [ ! -f "$HASH_FILE" ] || [ "$(md5sum < "$LOCK")" != "$(cat "$HASH_FILE")" ]; then
    echo "==> frontend: package-lock.json changed, reinstalling /node_modules..."
    cp /app/frontend/package.json "$LOCK" /
    (cd / && npm ci --no-audit --no-fund)
    md5sum < "$LOCK" > "$HASH_FILE"
fi

cd /app/frontend && npm run dev -- --host &
cd /app/backend && exec air
