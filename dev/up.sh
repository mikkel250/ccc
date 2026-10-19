#!/usr/bin/env bash
# Start local mocks, then CCC on PORT (default 3001) for the frontend on 3000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local && ! -f .env ]]; then
  echo "Create .env.local from .env.example plus dev/env.backend.example first." >&2
  exit 1
fi

node dev/start-mocks.mjs &
MOCKS_PID=$!
cleanup() {
  kill "$MOCKS_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=0
for _ in $(seq 1 25); do
  if curl -sf http://127.0.0.1:8079/health >/dev/null 2>&1 \
    && curl -sf http://127.0.0.1:4010/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [[ "$ready" -ne 1 ]]; then
  echo "Local mocks did not become healthy on :8079 and :4010." >&2
  exit 1
fi

PORT="${PORT:-3001}" npm run dev
