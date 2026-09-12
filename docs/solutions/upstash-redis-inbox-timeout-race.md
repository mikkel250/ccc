---
tags: [redis, upstash, inbox, timeout, reliability]
created: 2026-09-11
source: pr-50-inbox-review
---

# Upstash inbox Redis: Promise.race timeout residual

## Problem

Inbox claim/processed marks use `withTimeout` in `app/api/lib/inbox-processed-store.ts`, which rejects via `Promise.race` when `INBOX_REDIS_TIMEOUT_MS` elapses. The in-flight Upstash REST request is not cancelled.

## Why we keep Promise.race

`@upstash/redis` exposes no `AbortSignal`. Aborting the client HTTP call would only stop waiting locally; the server may still execute SET/EVAL. CodeRabbit’s “pass AbortSignal to Upstash” finding is deferred for that reason.

## Mitigations in code

- **Per-claim tokens** — `deleteIfValue`, `expireIfOwned`, and `markProcessedIfOwned` are token-gated.
- **SET NX after timeout** — GET reconciles: same token → won; another value → lost; empty key → `503` (`INBOX_REDIS_TIMEOUT_ERROR`), not `lost`.
- **Lease renewal failures** — `tailorLabeledMessage` aborts in-flight `runTailorCore` and does not release the claim on Redis timeout/unavailable (TTL fence).

## Residual risk

- A SET that commits after the client timed out can hold an orphan claim until `INBOX_CLAIM_TTL_SECONDS` (default 900s). No worker tailors; next scan may skip as `skipped-claimed`.
- `markInboxProcessed` EVAL has no SET-style reconcile yet; relevant when M8.5 marks processed after draft.

## When to revisit

Production symptoms: labeled messages stuck skipped-claimed for multiples of claim TTL, or inbox Redis timeouts correlated with missed JDs. Options then: custom fetch + AbortSignal (socket only), fewer round-trips, or operational Upstash latency fixes — not a blind swap to AbortSignal alone.
