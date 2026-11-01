---
title: "feat: Railway cron for inbox scan"
date: 2026-09-06
type: feat
topic: railway-inbox-cron
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: docs/plans/2026-09-05-002-feat-inbox-worker-plan.md
execution: code
---

# feat: Railway cron for inbox scan

## Goal Capsule

- **Objective:** Deployed Railway can invoke the same `npm run inbox:scan` job on a schedule (~5am UTC) so drafts appear while the laptop is closed. Reruns skip processed ids (already in M8.3/M8.5).
- **Authority:** Inbox product contract R14, R13 (Railway as target), STRATEGY “~5am” in `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`. Board: M8.6.
- **Open blockers:** None.
- **Stop when:** A Railway config runs `inbox:scan` on a cron and exits; the always-on API `railway.toml` is not turned into a cron; no second scan implementation.

## Product Contract

### Summary

M8.6 is the scheduled trigger only. The job is `scanInbox` / `npm run inbox:scan`. Cron must not be attached to the HTTP API service (`npm start` never exits, so Railway would skip later ticks).

### Key Decisions

- **Second Railway service, same repo, dedicated config file.** `(session-settled: user-directed — R14 same job; Railway cron processes must exit)` Rejected: `cronSchedule` on the API `railway.toml`. Rejected: a second scan codebase.
- **Default `0 5 * * *` UTC.** `(session-settled: user-directed — STRATEGY ~5am)` Railway evaluates cron in UTC.
- **Do not invent an HTTP scan route.** `(session-settled: user-directed — R8 no second public tailor presenter)` Cron start command is the existing CLI.

### Requirements

- R14. One scan implementation, two triggers.
- Deploy scans while the laptop is closed; processed ids skip.

### Scope Boundaries

- In: `railway.inbox-scan.toml`, operator docs, invariant test (API toml has no cron; scan toml starts `inbox:scan` at 05:00 UTC).
- Out: New scan logic; dashboard click-ops beyond documenting the second service + config path; schedule-send.

### Acceptance Examples

- AE1. `railway.inbox-scan.toml` `startCommand` is `npm run inbox:scan` and `cronSchedule` is `0 5 * * *`. **Covers R14.**
- AE2. `railway.toml` has no `cronSchedule` (API stays always-on). **Covers not breaking HTTP.**

## Planning Contract

### Key Technical Decisions

- KTD1. **Config file `railway.inbox-scan.toml`; operator points the cron service at it.** Instantiates R14 without forking the job.
- KTD2. **`restartPolicyType = "NEVER"`** on the cron service — the process must exit; Railway skips the next tick if a previous run is still alive.

## Implementation Units

### U1. Cron config + invariant test

- **Files:** `railway.inbox-scan.toml`, `tests/inbox-scan-railway.test.ts`, `docs/arch/FILE_LAYOUT.md`, `docs/test/TESTING.md`, `docs/api/API.md`, `.env.example`, `docs/plans/README.md`

## Definition of Done

- R14 holds. API service is not a cron. No second scan implementation.
