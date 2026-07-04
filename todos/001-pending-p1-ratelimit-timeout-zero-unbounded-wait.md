---
status: completed
priority: p1
issue_id: "001"
tags: [code-review, security, performance, reliability]
dependencies: []
---

# Ratelimit `timeout: 0` causes unbounded wait on degraded Redis

## Problem Statement

`app/api/lib/rate-limit.ts:48` sets `timeout: 0` on the `Ratelimit` constructor. This disables the Upstash SDK's internal timeout entirely. The SDK default is 5s, after which it returns `{ success: true }` (fail-open) to avoid blocking the application during Redis latency spikes. Setting it to `0` means "wait forever" — if Redis becomes slow but not fully down (e.g., network congestion, high Upstash load, TCP retransmission), the request will hang indefinitely rather than failing fast.

This exhausts Node.js event loop capacity per hung request, blocks Railway request slots (which are limited per instance), and could cascade into a full outage where all requests are stuck waiting for Redis.

The code comment correctly identifies the fail-open risk: _"Disable SDK fail-open race: default 5s timeout returns success:true on slow Redis."_ But `timeout: 0` (infinite wait) is the wrong fix. The correct approach is a bounded timeout (e.g., 2000ms) that fails closed.

## Findings

- **File:** `app/api/lib/rate-limit.ts:44-50` — `timeout: 0` disables all timeout enforcement
- **Upstash SDK behavior:** Default 5s timeout returns `{ success: true, reason: "timeout" }` — fail-open design for availability
- **Current behavior:** The `reason === "timeout"` catch at line 75 will only fire if the SDK itself decides to return a timeout (which it won't with `timeout: 0`)
- **Impact:** Under slow-Redis conditions, every request blocks the event loop. Railway Hobby instances have limited concurrency.
- **Code comment acknowledges but doesn't fix the root issue** — comment at line 47-48 explains the tradeoff but chooses infinite wait

## Proposed Solutions

### Option 1: Bounded fail-closed timeout with env var

**Approach:** Replace `timeout: 0` with a configurable timeout (env var `RATE_LIMIT_TIMEOUT_MS`, default 2000ms). When the SDK hits the timeout, it returns `{ success: true, reason: "timeout" }`, and our wrapper converts this to `ServiceError` (503). Add the env var to `.env.example`.

**Pros:**
- Fast failure under degraded Redis (503 in ~2s vs. hang forever)
- Configurable per environment (staging can use higher timeout)
- Follows AGENTS.md "every literal value is a future outage" rule
- Existing `reason === "timeout"` error path already handles this correctly

**Cons:**
- 2s timeout means ~2s added latency during Redis slowness (acceptable vs. LLM call at 5-30s)
- Requires one new env var

**Effort:** Small (30 min)

**Risk:** Low

---

### Option 2: Hardcoded timeout with inline comment

**Approach:** Replace `timeout: 0` with a hardcoded `timeout: 2000`. No new env var.

**Pros:**
- Dead simple
- Still fixes the unbounded wait

**Cons:**
- Violates AGENTS.md "every literal value is a future outage" rule
- Not tunable per environment

**Effort:** Trivial (5 min)

**Risk:** Low

---

### Option 3: Keep `timeout: 0` but add Node.js-level timeout via AbortController

**Approach:** Wrap the `rl.limit(identifier)` call with an `AbortController` timeout. If it fires, throw `ServiceError`.

**Pros:**
- Doesn't depend on SDK timeout mechanics

**Cons:**
- More complex code
- Duplicates timeout logic that the SDK already provides
- `Ratelimit.limit()` API doesn't accept an `AbortSignal`

**Effort:** Medium

**Risk:** Medium (complicated interaction with SDK internals)

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `app/api/lib/rate-limit.ts:44-50` — `timeout: 0` in `getRatelimit()`
- `app/api/lib/rate-limit.ts:74-76` — existing `reason === "timeout"` check (already correct)
- `.env.example:47-48` — add new env var if Option 1 chosen

## Resources

- **Upstash Ratelimit SDK docs:** https://upstash.com/docs/redis/sdks/ratelimit-ts/overview
- **Plan:** `docs/plans/2026-06-12-feat-upstash-redis-rate-limit-plan.md`
- **AGENTS.md rule:** "Every literal value is a future outage. Numbers, strings, URLs, timeouts, TTLs — if it is not a language keyword, it goes in process.env"

## Acceptance Criteria

- [ ] `timeout: 0` replaced with a bounded timeout (env-var-driven or hardcoded)
- [ ] Slow-Redis scenario produces 503 (ServiceError) within the timeout window, not indefinite hang
- [ ] If new env var added: documented in `.env.example` with comment
- [ ] `npm test` passes
- [ ] `npm run lint` passes

## Work Log

### 2026-06-12 - Initial Discovery (Code Review)

**By:** Pi Code Review (security-sentinel, performance-oracle, architecture-strategist)

**Actions:**
- Security-sentinel flagged `timeout: 0` as unbounded wait risk
- Performance-oracle confirmed the default SDK timeout behavior (5s fail-open)
- Architecture-strategist noted the existing `reason === "timeout"` code path already handles timeouts correctly

**Learnings:**
- The code comment at line 47-48 correctly diagnoses the fail-open problem but chooses the wrong fix
- The existing `reason === "timeout"` error path at line 74 is already correct — just needs the timeout to fire
