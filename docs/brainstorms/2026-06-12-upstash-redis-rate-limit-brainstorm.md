---
date: 2026-06-12
topic: upstash-redis-rate-limit
---

# Upstash Redis Rate Limiting

## What We're Building

Replace the current in-memory rate limiter (`app/api/lib/rate-limit.ts`) with Upstash Redis via the `@upstash/ratelimit` SDK. The existing sliding-window IP-burst strategy stays the same — the only change is the storage backend. A shared Redis client singleton is exported so future features (LLM response caching, session storage) can reuse the same Upstash database without additional setup.

## Why This Approach

**Approach A — `@upstash/ratelimit` SDK** — was chosen over raw Redis commands (Approach B: defeats the "don't roll our own" principle) and a generic Redis abstraction (Approach C: YAGNI over-engineering for a single-endpoint MVP).

The user's primary requirement is reducing maintenance burden by using an expert-built solution. `@upstash/ratelimit` is exactly that: a purpose-built rate limiting SDK that handles sliding windows, atomic counters, TTL-based expiry, and race conditions. The migration replaces ~130 lines of custom Map/setTimeout/prune logic with ~20 lines of SDK integration.

Upstash was chosen as the Redis provider because: (a) their rate limiting SDK is the most mature in the ecosystem, (b) they're serverless-friendly (HTTP-based, no persistent TCP connections — good fit for Railway), (c) the free tier (10,000 commands/day) easily covers rate limiting for this use case, and (d) the `@upstash/redis` client comes bundled and can be reused for future caching.

## Key Decisions

- **Keep the same rate limiting strategy:** IP-based burst detection via sliding window. Config stays on `RATE_LIMIT_MAX` (default 5) and `RATE_LIMIT_WINDOW` (default 60000ms). No new limit tiers or per-user quotas until auth exists.
- **Export a shared Redis client:** A `lib/redis.ts` module exports a singleton `@upstash/redis` client. `rate-limit.ts` imports it; future modules (caching, sessions) will too. One Upstash database, one client, zero additional setup.
- **Flexible rate limit key:** The `checkRateLimit` interface accepts an `identifier` parameter. Currently keyed on IP. When auth arrives, callers can pass a user ID instead — no interface change needed. The Upstash key pattern `ratelimit:{identifier}` works for both.
- **Fail closed on Redis errors:** If Upstash is unreachable, requests are rejected (503) rather than allowed through. This is safer than an in-memory fallback for a spend-protection use case. The existing `ServiceError` class already maps to 503.
- **Remove per-IP promise chain serialization:** The current code serializes concurrent same-IP requests via a per-IP promise chain. Redis INCR is atomic — the SDK handles this natively. Removing it simplifies the code further.
- **New env vars:** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` added to `.env.example`. Existing `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW` unchanged.

## Open Questions

- **Test migration strategy:** The current `rate-limit.ts` has extensive test-only exports (`resetStore`, `seedBucketForTest`, etc.). The new tests will need a different strategy — either mock the Upstash client or use a test Redis instance. Defer to planning phase.
- **Lazy initialization for the shared Redis client:** The existing pattern in the codebase (see `llm.ts` provider clients) uses lazy singletons. The Redis client should follow the same convention for consistency — decide exact pattern in planning.

## Next Steps

→ `/workflows-plan` for implementation details: file changes, test migration strategy, env var catalog update, and acceptance criteria.
