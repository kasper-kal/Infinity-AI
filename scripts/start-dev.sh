#!/bin/sh
# Freebuff preview command for the infinity-ai workspace.
# 1. Ensures Chrome's system libraries are present (idempotent, fast when done)
# 2. Copies env vars into the API server working directory (its dotenv reads
#    artifacts/api-server/.env)
# 3. Starts the API server (background, port 8080) and then the Vite frontend
#    (foreground, port 5173) so the preview readiness check sees the frontend.
#
# NOTE: the API server's stdout is redirected to a log file. Its output
# announces auxiliary ports (8080 + the Puppeteer WebSocket on 3002) that the
# preview's port detection mistook for the web port, which made readiness
# probe ws://localhost:3002, never get an HTTP response, and time out.
# Pinning Vite to PORT=5173 keeps the detected port unambiguous.

set -e
PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_ROOT" || exit 1

# 1. Chrome system deps for infinity-ai's personal browser (Puppeteer).
sh ./scripts/chrome-deps.sh

# Puppeteer may run under a different user (root) than the one that
# downloaded the browser — point it at the actual cache location.
export PUPPETEER_CACHE_DIR=/home/daytona/.cache/puppeteer

# 2. Env vars must reach the API server working directory.
#    Merge the Freebuff Keys-tab file (.env.local) with workspace defaults
#    (.env) — keys pasted in the Keys tab previously never reached the server
#    because only .env was copied. .env.local values win on duplicates.
cat .env.local .env 2>/dev/null | awk -F= '!seen[$1]++' > artifacts/api-server/.env

# 3. Start servers. API server in the background (output to a log file so the
#    preview's port detection only sees Vite), frontend in the foreground.
PORT=8080 pnpm --filter @workspace/api-server run dev > /tmp/infinity-ai-api-server.log 2>&1 &
sleep 4
PORT=5173 pnpm --filter @workspace/infinity-ai run dev
