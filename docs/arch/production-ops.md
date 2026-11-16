# Production ops

Operator runbook for the CCC API on Railway. Full env catalog and defaults: [`.env.example`](../../.env.example). API contracts: [`docs/api/API.md`](../api/API.md). This file is the rotation, health-check, and deploy/rollback procedure.

## Runtime

- Node 22 LTS. `.nvmrc` is `22`; `package.json` `engines` on this branch is `>=22.0.0`. Nixpacks reads `.nvmrc`.
- Open PR #83 (not this tree) raises `engines` to `>=22.15.0` for `@opentelemetry/sdk-node@0.301`. Do not treat 22.15 as already shipped until that PR merges.
- No Dockerfile. Railway builds with Nixpacks (`railway.toml`).

## Probes

| Route | Role | Railway |
|-------|------|---------|
| `GET /api/hello` | Liveness: Node process is up. No auth, master CV, or Redis. | Do **not** use as `healthcheckPath`. |
| `GET /api/ready` | Readiness: `auth`, `masterCv`, `redis` env/config. 200 or 503 `not_ready`. No LLM, no Redis ping, no secrets in the body. | `railway.toml` `healthcheckPath` / timeout 300s. |

A 200 on hello with 503 on ready means the process is up but cannot serve tailor: missing master CV or Redis env, or auth still 503 because instrumentation did not run. A missing `TAILOR_API_KEY` in a production-like deploy usually never reaches this state — startup exits first.

## Required production env

Catalog with defaults: `.env.example`. Do not copy that file into Railway as-is (`LANGFUSE_TRACING=false` is a safe default; empty provider keys are not).

| Var | If missing |
|-----|------------|
| `TAILOR_API_KEY` | **Startup fatal** in production-like deploys (`NODE_ENV=production` or `RAILWAY_ENVIRONMENT` / `VERCEL_ENV=production`). Crash-loop until set. Per-request 503 remains if instrumentation did not run. |
| `MASTER_CV_JSON` or `MASTER_CV_PATH` | Process can start; `GET /api/ready` `masterCv` fails (503). |
| `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` | Process can start; `GET /api/ready` `redis` fails (503). |
| At least one provider key matching `TAILOR_MODEL` | Ready may be 200; tailor LLM calls fail at request time. |

Optional: Langfuse / LangSmith (`LANGFUSE_TRACING` / `LANGSMITH_TRACING` must be exactly `true` to enable). Inbox cron also needs Gmail + `INBOX_SCAN_ENABLED=1` on that service.

Never set `TAILOR_AUTH_INSECURE_BYPASS` on Railway. Startup is fatal if it is set with a production marker.

## Rotate `TAILOR_API_KEY` (R21a)

Old Bearer tokens fail only after the web process has the new env (recycle). There is no dual-key overlap.

1. Generate a high-entropy secret: `openssl rand -base64 32`.
2. Set it as `TAILOR_API_KEY` on the **Railway web service** and in every Bearer presenter (smoke CLI, ccc-frontend BFF). Do not put the value on a command line, in a ticket, or in a screenshot.
   - Smoke (`npm run smoke`) reads `TAILOR_API_KEY` from the process environment. Its dotenv load is repo-root **`.env` only** — it does **not** load `.env.local` (Next.js `npm run dev` does). Put the rotated key in `.env`, or `export TAILOR_API_KEY=...` in the shell before smoke. If you keep secrets in `.env.local`, copy them: `cp .env.local .env`.
   - Railway deployment Details can show unmasked custom variables — treat dashboard access as secret access.
3. Recycle / redeploy the web service so the process picks up the new value.
4. Confirm: old Bearer → `POST /api/tailor-cv` **401**. New Bearer → smoke 200 (`npm run smoke -- <prod-url>`).
5. If the leak was in git or logs, assume the old value is burned; rotate again if it was committed.

**When to rotate:** suspected leak; secret value seen in a screenshot, ticket, or argv; **repeated 429s on the shared-secret bucket** (`RATE_LIMIT_SECRET_MAX`) while per-caller windows still have remaining — that is the origin leak signal. Rotate before raising the cap, unless the owner has already decided legitimate BFF concurrency needs a higher `RATE_LIMIT_SECRET_MAX`.

## Rate-limit defaults (owner)

Shipped defaults: `RATE_LIMIT_MAX=5` (per caller: `session:<id>` or IP) and `RATE_LIMIT_SECRET_MAX=2` (global hashed-secret cap). With 5 / 2 the global window wins first, so two BFF users cannot each get 5. Raising the secret cap is an **operator env change**, not a code default change. Typical BFF formula: `>= concurrent users × RATE_LIMIT_MAX`.

## Railway deploy

Web service (`railway.toml`):

- Builder: Nixpacks. `buildCommand` `npm run build`. `startCommand` `npm start`.
- Healthcheck: `/api/ready`, timeout 300, restart `ON_FAILURE`.
- Set the required env above as Railway variables (not committed files). Prefer `MASTER_CV_JSON` over a path inside the image.

Inbox cron (`railway.inbox-scan.toml`) is a **second** service: `npm run inbox:scan` at 05:00 UTC, `restartPolicyType = NEVER`. It does **not** present Bearer and does **not** call `ensureSecureStartup`, so a missing `TAILOR_API_KEY` will not crash-loop the cron job. Point that service at `railway.inbox-scan.toml` (do not add `cronSchedule` to `railway.toml` — `npm start` never exits).

## Rollback

| Method | Code | Secrets |
|--------|------|---------|
| Git revert the bad commit, push, let Railway rebuild | Previous tree | **Keeps current** Railway variables (including a rotated `TAILOR_API_KEY`) |
| Dashboard “redeploy previous successful deployment” | Previous image | Restores **that deployment’s custom variables**, including the old `TAILOR_API_KEY` |

After a **leak rotation**, do not dashboard-rollback across the rotation boundary unless you re-apply the new key before traffic returns. Prefer git revert + push for post-rotation rollbacks.

Confirm after rollback: `/api/ready` 200, then smoke with the Bearer that matches the **currently set** `TAILOR_API_KEY`.

## Manual checks (owner)

These need production Railway access and live secrets; the agent cannot run them.

- Dashboard: web healthcheck is `/api/ready` (not `/api/hello`).
- After env edits, recycle and watch for crash-loop vs ready 200.
- Rotation drill: new key on web + presenters, 401 with old Bearer, smoke with new.
- Decide whether deployed `RATE_LIMIT_SECRET_MAX` should stay 2 or be raised for BFF users.
