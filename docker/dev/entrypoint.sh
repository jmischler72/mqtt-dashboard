#!/bin/sh
# Dev container entrypoint: keep /node_modules in sync with the mounted
# lockfile, then run Vite and air side by side.
set -e

# Node resolves the nearest node_modules first, so a host-side `npm install`
# would shadow the container's Linux binaries with macOS ones. Compose masks
# /app/frontend/node_modules with an empty tmpfs to prevent that; warn rather
# than exit if it is populated anyway (mask dropped, or `docker run` by hand).
if [ -n "$(ls -A /app/frontend/node_modules 2>/dev/null)" ]; then
    echo "WARNING: /app/frontend/node_modules is not empty — the tmpfs mask in" >&2
    echo "         docker-compose-dev.yml is missing, and these deps will shadow" >&2
    echo "         the container's own in /node_modules." >&2
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
