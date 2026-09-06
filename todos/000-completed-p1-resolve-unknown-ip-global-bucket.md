---
status: completed
priority: p1
issue_id: "000"
tags: [code-review, security, rate-limit, dos]
dependencies: []
---

# Resolve "unknown" IP bucket global cross-user DoS

## Context

The recent migration to Upstash Redis for rate limiting (PR #X) changed the behavior of the `"unknown"` IP fallback.

When `TRUSTED_PROXIES` is empty or the client IP cannot be resolved, `route.ts` assigns the identifier `"unknown"`. Previously, this bucket was limited to 5 requests per minute *per container* and reset on deploys. Now, it is a **global shared bucket** in Redis.

If a single bad actor (or misconfigured proxy) exhausts this bucket, all other unidentified legitimate traffic will receive a `429 Too Many Requests`.

## Action Required

Create a separate, focused PR to address this API policy change (kept separate from the Redis infra PR to isolate rollback risk).

**Options for the fix:**
1. **Strict Policy (Recommended):** If `parseClientIp` yields `"unknown"`, throw a `400 Bad Request: Cannot determine client IP`. This forces infrastructure/proxy misconfigurations to be fixed rather than silently collapsing traffic.
2. **Session Fallback:** If `ip` cannot be resolved, fall back to using the `sessionId` from the request body as the rate-limit identifier, so un-proxied users are at least isolated by session.

## Review Notes

This was flagged as a P1 issue by the Tier 2 security review, but deferred to a fast-follow PR to avoid conflating infrastructure swaps with API policy changes.

## Resolution — 2026-07-04

Verifying the rate limiter (`npm run build`, `tsc --noEmit`) surfaced that the bug was worse than described: `NextRequest.ip` was removed in Next.js 15, so `peerIp` was `"unknown"` for **every** request, not just when `TRUSTED_PROXIES` was empty. The `TRUSTED_PROXIES` peer-validation branch was unreachable dead code, and all production traffic was already sharing the single global "unknown" bucket.

Fix (see `docs/plans/2026-07-04-001-fix-rate-limit-client-ip-resolution-plan.md`):
- `parseClientIp` now trusts the **rightmost** `x-forwarded-for` entry (the one our own edge proxy appends) instead of `request.ip`. `TRUSTED_PROXIES` and `x-real-ip` handling removed — there's no raw peer-socket address available in a Next.js 15 Route Handler on Railway to validate against.
- **Option 1 (Strict Policy)** implemented: `parseClientIp` returning `"unknown"` now returns `400 { error: "Cannot determine client IP" }` before rate limiting or body validation runs.

## Work Log

### 2026-07-04 — Resolved

**By:** Cursor agent, `feature/rate-limit-unknown-ip-fastfollow`

**Actions:**
- Rewrote `parseClientIp` in `app/api/tailor-cv/route.ts` to resolve IP from `x-forwarded-for` only (rightmost entry), removing `TRUSTED_PROXIES`.
- Added strict `400` rejection when IP resolution fails.
- Removed `TRUSTED_PROXIES` from `.env.example`.
- Updated `tests/route.test.ts`: anti-spoofing (rightmost-trusted) test, missing/invalid-IP → 400 tests, no-rate-limit-consumption-on-400 test.
