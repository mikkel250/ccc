#!/usr/bin/env bash
# Start local mocks, then CCC on PORT (default 3001) for the frontend on 3000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.local ]]; then
  ENV_FILE=".env.local"
elif [[ -f .env ]]; then
  ENV_FILE=".env"
else
  echo "Create .env.local from .env.example plus dev/env.backend.example first." >&2
  exit 1
fi

# Apply the selected file to this shell without overriding existing variables,
# so the mock processes and Next.js see the same values even when Next does not
# load that file itself.
eval "$(node --input-type=module --eval '
import fs from "node:fs";
import { formatUnsetExports } from "./dev/load-env-file.mjs";
process.stdout.write(formatUnsetExports(fs.readFileSync(process.argv[1], "utf8"), process.env));
' "$ENV_FILE")"

node dev/start-mocks.mjs &
MOCKS_PID=$!
NEXT_PID=""
cleanup() {
  if [[ -n "${MOCKS_PID}" ]]; then
    kill "$MOCKS_PID" 2>/dev/null || true
  fi
  if [[ -n "${NEXT_PID}" ]]; then
    kill "$NEXT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

ready=0
for _ in $(seq 1 25); do
  if curl -sf http://127.0.0.1:8079/health >/dev/null 2>&1 \
    && curl -sf http://127.0.0.1:4010/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$MOCKS_PID" 2>/dev/null; then
    echo "Local mocks exited before becoming healthy." >&2
    wait "$MOCKS_PID" || true
    exit 1
  fi
  sleep 0.2
done
if [[ "$ready" -ne 1 ]]; then
  echo "Local mocks did not become healthy on :8079 and :4010." >&2
  exit 1
fi

PORT="${PORT:-3001}" npm run dev &
NEXT_PID=$!

while true; do
  if ! kill -0 "$MOCKS_PID" 2>/dev/null; then
    set +e
    wait "$MOCKS_PID"
    status=$?
    set -e
    exit "$status"
  fi
  if ! kill -0 "$NEXT_PID" 2>/dev/null; then
    set +e
    wait "$NEXT_PID"
    status=$?
    set -e
    exit "$status"
  fi
  sleep 0.2
done
