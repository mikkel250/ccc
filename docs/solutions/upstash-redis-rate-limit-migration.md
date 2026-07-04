---
tags: [rate-limit, redis, upstash, migration, testing, review, infrastructure]
created: 2026-07-02
source: feature/upstash-rate-limit-brainstorm
---

# Upstash Redis Rate-Limit Migration

## Problem

The CV Tailoring API used an **in-process `Map`-based rate limiter** that reset on every deploy and couldn't coordinate across multiple Railway instances. Each container had its own independent burst counter, meaning horizontally scaled deploys would allow N× the intended request rate. The hand-rolled implementation also carried maintenance burden: per-IP promise chains, idle-prune timers, and timestamp arrays (~110 lines of bespoke synchronization code).

## Root Cause

The original design was intentionally stateless (MVP constraint). As the API matured toward production readiness, the lack of cross-instance coordination became a correctness bug: `RATE_LIMIT_MAX=5` meant 5 requests _per container_, not 5 requests total. Redis was the natural fix — a durable, atomic counter shared across all instances.

## Solution

### Step 1: Add Upstash Redis dependencies

```bash
npm install @upstash/redis @upstash/ratelimit
```

`package.json` now declares both as direct dependencies (not relying on `@upstash/ratelimit`'s transitive hoisting).

### Step 2: Create a lazy Redis client singleton (`app/api/lib/redis.ts`)

```typescript
import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    if (!url) throw new Error("UPSTASH_REDIS_REST_URL is not configured");
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!token) throw new Error("UPSTASH_REDIS_REST_TOKEN is not configured");
    redisClient = new Redis({ url, token });
  }
  return redisClient;
}

export function resetRedisClientForTest(): void {
  if (process.env.NODE_ENV !== "test")
    throw new Error("resetRedisClientForTest is only available in the test environment");
  redisClient = null;
}
```

### Step 3: Replace in-memory limiter with `@upstash/ratelimit` SDK

The old ~110-line implementation (per-IP `Map`, promise chains, prune timers) was replaced with a ~30-line wrapper around the SDK:

```typescript
import { Ratelimit } from "@upstash/ratelimit";

const RATE_LIMIT_MAX = Math.max(1, Math.floor(getEnvNumber("RATE_LIMIT_MAX", 5)));
const RATE_LIMIT_WINDOW_MS = Math.max(1, Math.floor(getEnvNumber("RATE_LIMIT_WINDOW", 60000)));
const RATE_LIMIT_TIMEOUT_MS = Math.max(1, Math.floor(getEnvNumber("RATE_LIMIT_TIMEOUT_MS", 2000)));
const RATE_LIMIT_REDIS_PREFIX = getEnvString("RATE_LIMIT_REDIS_PREFIX", "ratelimit") ?? "ratelimit";

function getRatelimit(): RatelimitLike {
  if (!ratelimit) {
    ratelimit = new Ratelimit({
      redis: getRedisClient(),
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, `${RATE_LIMIT_WINDOW_MS} ms`),
      prefix: RATE_LIMIT_REDIS_PREFIX,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    });
  }
  return ratelimit;
}
```

Key: `timeout: 2000` replaces the earlier `timeout: 0` (unbounded wait). The SDK's default 5s fail-open (`success: true` on timeout) is converted to fail-closed via a `reason === "timeout"` check that throws `ServiceError`.

### Step 4: Test injection seam with production guard

```typescript
export function __injectRatelimitForTest(r: RatelimitLike | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__injectRatelimitForTest is only available in the test environment");
  }
  ratelimit = r;
}
```

This replaces the previous approach of mocking per-IP `Map` internals. Tests inject a mock `RatelimitLike` object that implements `limit(identifier)` — no need to touch SDK internals.

### Step 5: Shared test mock factory (`tests/helpers/rate-limit-mock.ts`)

```typescript
import type { Ratelimit } from "@upstash/ratelimit";

export type RatelimitResponse = Awaited<ReturnType<Ratelimit["limit"]>>;
export type RatelimitLike = Pick<Ratelimit, "limit">;

export function createSlidingWindowMock(config: SlidingWindowConfig): RatelimitLike {
  const buckets = new Map<string, number[]>();
  return {
    limit: async function mockLimit(identifier: string): Promise<RatelimitResponse> {
      await new Promise(resolve => setImmediate(resolve)); // yield for concurrency
      // ...sliding-window logic...
    },
  };
}
```

Types are _derived_ from the real SDK (`Ratelimit["limit"]`) rather than hand-duplicated — structural compatibility without `as any`. Three factories: `createSlidingWindowMock`, `createFailingMock`, `createTimeoutMock`. Both test files import from this single source of truth.

### Step 6: Route integration — pass sessionId + identifier

```typescript
// app/api/tailor-cv/route.ts
const ipAddress = parseClientIp(request);
const rateLimit = await tailorCvDeps.checkRateLimit(sessionId, ipAddress);
```

The `checkRateLimit` signature accepts `_sessionId` (forward-looking, unused) and `identifier` (the actual rate-limit key). The `rateLimitKey` intermediate variable was removed (dead code).

## Key Decisions

| Decision | Rationale |
|---|---|
| Lazy singleton for Redis client and Ratelimit | Same pattern as `llm.ts` provider clients; no connection at import time |
| `timeout: 2000` fail-closed | SDK default 5s fail-open would silently pass traffic during outages |
| Env-var-driven config (`RATE_LIMIT_TIMEOUT_MS`, `RATE_LIMIT_REDIS_PREFIX`) | AGENTS.md: "every literal value is a future outage" |
| `__injectRatelimitForTest` with `NODE_ENV` guard | Test seam callable only in test; throws in production |
| Derive mock types from SDK (`ReturnType<Ratelimit["limit"]>`) | Zero `as any` casts; mock stays compatible with SDK updates |
| Shared mock factory in `tests/helpers/` | Eliminates 90% duplicate mock code between test files |
| `ServiceError` preserves cause via `{ cause: error }` | Underlying Redis/Upstash errors traceable in logs |

## Code Review Findings & Resolutions

The Tier 3 review surfaced 7 findings. Resolutions:

1. **Concurrent test interleaving** — Mock now yields via `setImmediate`, enabling `Promise.all` tests to interleave
2. **Blocked message not asserted** — Test now checks `blocked.message` (429 response payload completeness)
3. **ServiceError checks name only** — Now asserts `instanceof Error` + exact message, not just `.name`
4. **TRUSTED_PROXIES XFF spoofing** — Deferred to fast-follow PR (`todos/000-*.md`); not blocking merge
5. **"unknown" IP shared bucket** — Ruled a deployment config concern, not a code regression
6. **Duplicate mock factories** — Consolidated into `tests/helpers/rate-limit-mock.ts`
7. **Catch block discards cause** — Now preserves underlying error via `{ cause: error }`

All three P3 items (type-safe mocks without `as any`, config dedup using `getRateLimitConfig()`, JSDoc on `checkRateLimit`) were also resolved before merge.

## Prevention Strategies

1. **Prefer SDK-derived types over hand-duplicated interfaces.** Use `Pick<Ratelimit, "limit">` and `Awaited<ReturnType<Ratelimit["limit"]>>` rather than writing matching interfaces by hand. They stay in sync with SDK updates automatically.
2. **Guard test-only exports with `NODE_ENV !== "test"` checks.** One `throw` prevents production exposure of injection seams. Apply to every `__*ForTest` or `reset*ForTest` function.
3. **Shared test factories over copy-pasted mocks.** If two test files need the same mock, extract to `tests/helpers/` immediately. The `createTimeoutMock` factory was discovered during P3 cleanup — a third variant that would have been copied again.
4. **Bounded timeouts on all external service calls.** `timeout: 0` means infinite wait. Always set an explicit ms value, even if it's a 30s default for slow services. For rate limiters specifically: fail-closed (503) is safer than fail-open (silently passing traffic).
5. **Test assertions should validate the full response shape.** When an endpoint returns `{ error, remaining, resetTime }`, assert all three fields. The missing `message` assertion was caught in review — the test passed but left a coverage gap.
6. **Use production config functions in tests, not re-parsed env vars.** Replace `parseInt(process.env.X || "5", 10)` with `getRateLimitConfig().maxRequests`. The production function is the single source of truth; duplicating env parsing in tests creates drift risk.

## Cross-References

- **`docs/solutions/api-hardening-typed-errors-and-map-cleanup.md`** — Previous hardening pass on the in-memory rate limiter (typed errors, per-IP promise chains, idle-prune timers). The Redis migration replaces the implementation hardened in that pass.
- **`docs/plans/2026-06-12-feat-upstash-redis-rate-limit-plan.md`** — Full Tier 3 review with all findings and validation.
- **`todos/000-pending-p1-resolve-unknown-ip-global-bucket.md`** — Deferred: global "unknown" IP bucket creates cross-user DoS risk when `TRUSTED_PROXIES` is unset.
- **`docs/brainstorms/2026-06-12-upstash-redis-rate-limit-brainstorm.md`** — Design exploration that led to the plan.
- **`docs/arch/README.md`** — Architecture decisions and stack documentation.
