---
title: "feat: Production ops runbook and R5d startup fail-closed"
date: 2026-11-16
type: feat
topic: production-ops-runbook
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# feat: Production ops runbook and R5d startup fail-closed

## Goal Capsule

- **Objective:** An operator can deploy, health-check, rotate the shared secret, and roll back this API on Railway from one runbook, and a production process with no `TAILOR_API_KEY` crash-loops rather than remaining a healthy 503-only process.
- **Means:** Add `docs/arch/production-ops.md` as the ops runbook (catalog pointer, not a second env source of truth). Extend `ensureSecureStartup` so production-like deploys also fatal when the shared secret is unset, matching R5d in `docs/plans/2026-07-20-001-feat-json-curator-cv-pipeline-plan.md`.
- **Authority:** This plan. Product origin: R5d / R21a in that JSON-curator plan. Nightly production-readiness loop (do not overlap GitHub #82 or #83).
- **Stop when:** Runbook exists and is indexed; production-like missing `TAILOR_API_KEY` is a startup fatal with tests; lint, typecheck, tests, and build pass; one PR is open against `main`. Do not merge or close any PR. Do not edit `package.json` / lockfile.

## Product Contract

### Summary

Close the remaining production-ops gap: a single operator runbook plus the missing R5d startup fatality for an unset shared secret. Do not change tailor HTTP success behavior, rate-limit defaults, or files owned by open PRs #82 and #83.

### Problem Frame

Security, docs, and deploy are only partial: Bearer is timing-safe and dual-bucket rate limits exist, but there is no key-rotation runbook; `/api/hello` vs `/api/ready` and Railway rollback live in scattered README/API notes; `ensureSecureStartup` fatals only when `TAILOR_AUTH_INSECURE_BYPASS` is set in a production-like deploy. Missing `TAILOR_API_KEY` in production is a per-request 503, which Railway can mark unhealthy but does not crash-loop the way the existing bypass comment says operators must notice.

### Key Decisions

- **Ship the ops runbook, not APM, a Dockerfile, or a rate-limit default change.** `(session-settled: user-directed — chosen over overlapping #82/#83 or changing RATE_LIMIT_SECRET_MAX: those are owner/open-PR work)` Governs R1, R6, R7, R8.
- **Leave `RATE_LIMIT_SECRET_MAX` default at floor(RATE_LIMIT_MAX / 2) (shipped 5 / 2).** `(session-settled: user-directed — chosen over raising the default to 5: owner question from the last loop)` Governs R6.
- **Do not edit `package.json`, lockfile, or #82/#83 paths.** `(session-settled: user-directed — chosen over bumping engines to >=22.15.0 here: #83 owns that bump)` Governs R8.

### Requirements

- R1. Add `docs/arch/production-ops.md` covering: required production env (pointer to `.env.example` as the catalog), `TAILOR_API_KEY` rotation (R21a), `/api/hello` vs `/api/ready` semantics, Railway web + inbox-cron deploy and rollback, Node 22 via `.nvmrc` / current `engines` `>=22.0.0`. Stay under the docs size budget (prefer ≤200 lines); do not duplicate the full `.env.example` table. Index it from `docs/api/API.md`, `.env.example`, and `docs/README.md` — not from files open PR #83 already edits.
- R2. Production-like deploys (`NODE_ENV=production` or `RAILWAY_ENVIRONMENT`/`VERCEL_ENV=production`) fatal at startup when `TAILOR_API_KEY` is unset or whitespace-only, in addition to the existing bypass+prod fatal. Log a message that names the missing var and does not print secret values.
- R3. `NODE_ENV=test` still makes `ensureSecureStartup` a no-op (does not `process.exit`) so the suite can set production-like markers.
- R4. Non-production local/dev without a key stays per-request 503 unless bypass is on. Do not fatal local unset key at startup.
- R5. Per-request `authenticateTailorRequest` 401/503 mapping is unchanged. Keep the production-unset-key 503 as belt-and-suspenders if instrumentation did not run.
- R6. Document (do not change) that defaults `RATE_LIMIT_MAX=5` / `RATE_LIMIT_SECRET_MAX=2` make the global cap win first; raising the secret cap is an operator env change after owner decision. Repeated secret-bucket 429s are a suspected-leak signal: rotate `TAILOR_API_KEY` (R21a) before raising the cap, unless the owner has already decided legitimate BFF concurrency needs a higher `RATE_LIMIT_SECRET_MAX`.
- R7. Runbook must distinguish `GET /api/hello` (liveness; Railway must not use it as `healthcheckPath`) from `GET /api/ready` (readiness; `railway.toml` `healthcheckPath`).
- R8. Independent of open PRs. Do not modify #82 files (`app/api/ready/route.ts`, `app/api/lib/langfuse-otel.ts`, `docs/arch/APP_WALKTHROUGH.md`, `tests/readiness.test.ts`, `tests/langfuse-otel.test.ts`, `tests/llm-chat-dispatch.test.ts`, `tests/inbox-scan.test.ts`, `tests/route.test.ts`) or #83 files (`.npmrc`, `AGENTS.md`, `README.md`, `app/api/lib/cv-schema.ts`, `app/api/lib/langfuse-otel.ts`, `docs/arch/FILE_LAYOUT.md`, `docs/arch/README.md`, `docs/test/TESTING.md`, `eslint.config.mjs`, `instrumentation.ts`, `next.config.mjs`, `package-lock.json`, `package.json`, `tests/eslint-config.test.ts`, `tests/langfuse-otel.test.ts`, `tests/next-config.test.ts`, `tsconfig.json`). Do not add a Dockerfile.

### Actors

- A1. Operator — deploys this API on Railway, sets env, rotates `TAILOR_API_KEY`, rolls back.
- A2. Railway platform — Nixpacks build, `/api/ready` healthcheck, restart on failure; separate inbox cron service.
- A3. Bearer presenters — smoke CLI and the ccc-frontend BFF; must update the key in the same rotation window as the Railway web service.

### Key Flows

- F1. Operator follows the runbook to deploy or roll back the web service and confirm `/api/hello` vs `/api/ready`.
- F2. Operator rotates `TAILOR_API_KEY` on the Railway web service and in every Bearer presenter (smoke CLI, ccc-frontend) in the same window, then recycles the web service; old Bearer tokens fail after recycle.
- F3. Production process starts with no `TAILOR_API_KEY` → startup fatal (crash-loop), not a healthy 503-only process.
- F4. Local `npm run dev` with unset key and no bypass still serves, and tailor returns 503.

### Acceptance Examples

- AE1. `getStartupSecurityError()` (or equivalent pure helper) with `NODE_ENV=production` and unset or whitespace-only `TAILOR_API_KEY` returns a fatal message naming the var. **Covers R2.**
- AE2. Same helper with production-like + bypass set still returns the existing bypass fatal. **Covers R2.**
- AE3. Same helper with production-like + non-empty `TAILOR_API_KEY` and bypass off returns undefined. **Covers R2, R5.**
- AE4. `ensureSecureStartup()` under `NODE_ENV=test` with production markers and missing key does not throw / does not exit. **Covers R3.**
- AE5. Non-production, unset key, bypass off → helper returns undefined; `authenticateTailorRequest` still 503. **Covers R4, R5.**
- AE6. Runbook states hello vs ready, Railway `healthcheckPath=/api/ready`, rotation steps, and that Node on this branch is `>=22.0.0` / `.nvmrc` `22`. **Covers R1, R7.**

### Scope Boundaries

- In: `tailor-auth.ts` startup helper + `tests/tailor-auth.test.ts`; `docs/arch/production-ops.md`; indexes in `docs/api/API.md`, `.env.example`, and `docs/README.md` (not `README.md` / `docs/arch/README.md` / `docs/arch/FILE_LAYOUT.md` — those are in #83).
- Out: Dockerfile; APM; Redis/master-CV startup fatality (those stay `/api/ready`); changing `RATE_LIMIT_SECRET_MAX` default; inbox scan behavior; LLM/provider routing; package.json/lockfile/engines bump.

### Deferred to Follow-Up Work

- Owner decision: raise deployed `RATE_LIMIT_SECRET_MAX` so BFF per-user caps can fire.
- After #83 merges: runbook Node line can mention `engines` `>=22.15.0` without this PR editing package.json.
- APM / request tracing beyond existing Langfuse/LangSmith + `X-Request-Id`.
- Dockerfile if Nixpacks is later abandoned.

### Success Criteria

- Operator can rotate the shared secret and roll back Railway using only the new runbook plus `.env.example`.
- Production misconfig with no `TAILOR_API_KEY` is a startup crash, covered by AE1–AE5.

## Planning Contract

### Key Technical Decisions

- KTD1. **Pure `getStartupSecurityError(): string | undefined` plus existing `ensureSecureStartup` wrapper.** Tests assert the helper; `ensureSecureStartup` still no-ops exit when `NODE_ENV=test` and otherwise `console.error` + `process.exit(1)`. Challenge to mocking `process.exit`: the suite already special-cases test env; a pure helper matches `isProductionLikeDeploy` / `getConfiguredTailorApiKey`. Governs R2, R3.
- KTD2. **Fatal missing key only in production-like deploys, not locally.** Local unset key remains per-request 503 so `npm run dev` without secrets still boots. Governs R4.
- KTD3. **Do not fatal missing Redis or master CV at startup.** `/api/ready` already fails those checks; Railway `healthcheckPath` is that route (#82 owns extra 503-on-throw coverage). Governs R8.
- KTD4. **Runbook lives at `docs/arch/production-ops.md` and points at `.env.example`.** Required-in-production subset as a short table; full catalog stays `.env.example`. Governs R1.
- KTD5. **Document Node as `.nvmrc` `22` and `engines` `>=22.0.0` on this branch.** Mention that #83 (not this PR) raises engines to `>=22.15.0`. Governs R1, R8.

### Assumptions

- Highest-value next improvement is this runbook plus the R5d gap, not APM or a Dockerfile (agent bet from the nightly checklist and open PRs).
- Railway dashboard Rollback restores that deployment's image **and custom variables** (including `TAILOR_API_KEY`). Git revert + push keeps current service variables. After a leak rotation, do not dashboard-rollback across the rotation boundary unless the new key is re-applied before traffic returns.
- Inbox cron (`railway.inbox-scan.toml`) is a second service; the runbook points at it rather than duplicating M8.6. `inbox:scan` does not call `ensureSecureStartup` and does not present Bearer, so a missing `TAILOR_API_KEY` does not crash-loop the cron service.
- `npm run build` stays safe because `instrumentation.ts` returns unless `NEXT_RUNTIME === "nodejs"`; U1 must not `process.exit` at module load.

### Sequencing

U1 (startup helper + tests) → U2 (runbook + indexes). Execution note: TDD on U1.

### Sources and Research

- `app/api/lib/tailor-auth.ts`, `instrumentation.node.ts`, `tests/tailor-auth.test.ts`
- `app/api/hello/route.ts`, `app/api/ready/route.ts`, `app/api/lib/readiness.ts`, `railway.toml`, `railway.inbox-scan.toml`
- `.env.example`, `README.md` Deployment, `docs/api/API.md` (rotation one-liner already exists)
- Origin R5d / R21a: `docs/plans/2026-07-20-001-feat-json-curator-cv-pipeline-plan.md`
- Open PRs to avoid: #82 (readiness/Langfuse/LLM timeout tests), #83 (Next 16 / OTEL / engines)
- Packs unresolved this run (`packs-resolve.py` warning: not inside git at invoke cwd); `docs/solutions/` has no ops-runbook learning

## Implementation Units

### U1. Production-like missing-key startup fatal

**Goal:** Production-like deploys crash at `ensureSecureStartup` when `TAILOR_API_KEY` is unset, while tests and local boot stay safe.

**Requirements:** R2, R3, R4, R5. Cites KTD1, KTD2, KTD3.

**Dependencies:** None.

**Files:**
- `app/api/lib/tailor-auth.ts` — extract `getStartupSecurityError`; `assertSecureStartup` uses it; keep test-env no-op on exit
- `tests/tailor-auth.test.ts` — AE1–AE5
- `instrumentation.node.ts` — no call-site change unless the exported name used by register needs a comment

**Approach:**
1. Add `getStartupSecurityError()` that does not special-case `NODE_ENV=test`.
2. Return the existing bypass+prod message when bypass is requested in a production-like deploy.
3. Else if production-like and `getConfiguredTailorApiKey()` is undefined, return a fatal naming `TAILOR_API_KEY` (no key value).
4. `ensureSecureStartup`: if `NODE_ENV=test` return; if helper returns a message, `console.error` it and `process.exit(1)`.
5. Do not change `authenticateTailorRequest`.

**Execution note:** Write AE1 failing first (production + unset key currently returns undefined), then implement.

**Test scenarios:**
- Happy: AE3 production + key set + bypass off → undefined.
- Happy: AE5 local unset key → helper undefined; authenticate still 503.
- Error: AE1 production + unset/whitespace key → message matches `/TAILOR_API_KEY/` and does not include a secret value.
- Error: AE2 production + bypass (key set or not) → existing bypass fatal text.
- Edge: AE4 `NODE_ENV=test` + `RAILWAY_ENVIRONMENT=production` + unset key → `ensureSecureStartup` does not throw; helper may still report (assert helper separately from the wrapper).
- Edge: `VERCEL_ENV=production` with unset key → same fatal as NODE_ENV=production.

**Verification:** `node --import ./tests/set-node-env-test.mjs --import tsx --test tests/tailor-auth.test.ts`

### U2. Production ops runbook and indexes

**Goal:** One operator document for env, rotation, probes, Railway deploy/rollback, and Node.

**Requirements:** R1, R6, R7, R8. Cites KTD4, KTD5.

**Dependencies:** U1 (runbook describes the new startup fatal).

**Files:**
- `docs/arch/production-ops.md` — create
- `docs/api/API.md` — Rotation (R21a) link to the runbook (keep the one-liner)
- `.env.example` — short comment near `TAILOR_API_KEY` pointing at the runbook
- `docs/README.md` — index line under `arch/`
- `docs/plans/README.md` — do not add this ops leftover as a product milestone
- Do not edit `README.md`, `docs/arch/README.md`, or `docs/arch/FILE_LAYOUT.md` (#83)

**Approach:** Required-production env table: `TAILOR_API_KEY`, `MASTER_CV_JSON` or `MASTER_CV_PATH`, `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, at least one provider key matching `TAILOR_MODEL`. Optional: Langfuse/LangSmith, Gmail/inbox. Only missing `TAILOR_API_KEY` is a production-like startup fatal (R2); missing master CV or Redis fail `GET /api/ready` only (KTD3). Rotation: `openssl rand -base64 32` (or equivalent); set the value only in Railway web-service env and Bearer presenters (smoke `.env`, ccc-frontend); smoke must read `TAILOR_API_KEY` from the environment, not argv; recycle the web service; confirm 401 with the old Bearer and 200 with the new via smoke. Repeated secret-bucket 429s: rotate before raising `RATE_LIMIT_SECRET_MAX` unless the owner already decided BFF concurrency needs a higher cap. Probes: hello = process up; ready = auth/master/Redis config; Railway uses ready. Deploy: Nixpacks `npm run build` / `npm start`, healthcheck timeout 300, `ON_FAILURE` restart; inbox cron is the other toml and does not crash on missing `TAILOR_API_KEY`. Rollback: git revert + push keeps current secrets; dashboard Rollback restores that deployment's custom variables — after a leak rotation, re-apply the new key before traffic returns. Node: `.nvmrc` 22, engines `>=22.0.0` here; do not claim 22.15 as already shipped.

**Test expectation:** none — docs. Do not add markdown-string tests. Do not edit `tests/readiness.test.ts`.

**Verification:** runbook exists, is indexed, stays within the docs size budget, and does not contradict `railway.toml` / API probe sections.

## Verification Contract

- `npm run lint`
- `npm run typecheck:tests` (via `npm test` pretest or direct)
- `npm test`
- `npm run build`
- Targeted: `node --import ./tests/set-node-env-test.mjs --import tsx --test tests/tailor-auth.test.ts`
- Manual this agent: `npm run dev` with a configured key — `GET /api/hello` 200; `GET /api/ready` as configured; `POST /api/tailor-cv` without Bearer still 401. With unset `TAILOR_API_KEY` and bypass off, local tailor still 503 and the process stays up (R4). Do not treat `next start` as the keyless probe: `NODE_ENV=production` is the U1 crash path when the key is unset. Optional: `next start` **with** `TAILOR_API_KEY` set to confirm production boot. Do not require live Railway.

## Definition of Done

- U1–U2 complete; no #82/#83 files in the diff; no package.json/lockfile.
- AE1–AE6 satisfied (AE6 by the runbook text).
- Lint, typecheck, tests, build green.
- One PR against `main` with rotation + hello/ready + Railway rollback in the body. Never merge, close, or force-push.
