## Review — Tier 3: 2026-06-12

**Validation Summary:** 6 confirmed, 1 refuted, 0 needs human review

**Assessed Findings:**

- **[Concurrent test runs sequentially not parallel]:** Confirmed
  - **Evidence:** `tests/rate-limit.test.ts` uses `Promise.all` over synchronous mock calls that contain no `await` statements in the mutation logic. This resolves synchronously without interleaving execution. 
  - **Notes:** Tests synchronous logic rather than async race conditions.

- **[Blocked message field not asserted]:** Confirmed
  - **Evidence:** `app/api/lib/rate-limit.ts` returns a custom `message` when blocked, but `tests/rate-limit.test.ts` only asserts the `resetTime` field, dropping coverage for the message payload.
  - **Notes:** Could cause unhandled regressions in the JSON response mapping.

- **[ServiceError test checks name only]:** Confirmed
  - **Evidence:** `tests/rate-limit.test.ts` checks `(err as Error).name === 'ServiceError'` rather than `instanceof` or exact message matching.
  - **Notes:** Tests internal property structure instead of the thrown error instance.

- **[TRUSTED_PROXIES never validates connecting peer — X-Forwarded-For spoofing bypasses per-IP limits]:** Confirmed
  - **Evidence:** `route.ts` parses `X-Forwarded-For` without asserting the immediate connecting IP is physically in the `TRUSTED_PROXIES` set.
  - **Notes:** Allows spoofed headers to bypass IP rate limiting rules.

- **[Default config collapses all clients into shared "unknown" bucket — cross-user DoS]:** Refuted
  - **Evidence:** Pre-existing issue caused by `.env.example` leaving `TRUSTED_PROXIES` empty, which falls back to "unknown".
  - **Notes:** This is a deployment config issue, not a code defect introduced by the Redis migration.

- **[createSlidingWindowMock duplicated across test files]:** Confirmed
  - **Evidence:** `tests/rate-limit.test.ts` and `tests/route.test.ts` both use identical `createSlidingWindowMock` implementations.
  - **Notes:** Violates DRY and complicates future mock updates.

- **[Catch block discards underlying error]:** Confirmed
  - **Evidence:** `rate-limit.ts` throws `new ServiceError("Rate limit service unavailable")` without preserving the underlying Upstash exception as a `cause`.
  - **Notes:** Loses stack traces and context for underlying Redis connectivity errors.

**Spot-Check Results:**
- **Security & Auth**: Missing input validation. As noted in the confirmed findings, `x-forwarded-for` validation remains poorly protected if `TRUSTED_PROXIES` is populated.
- **Supply Chain Risks**: Clean.
- **Error Handling & State Recovery**: Swallowed exceptions. `app/api/lib/rate-limit.ts` throws a new `ServiceError` wiping out the `cause`.
- **Async / Concurrency**: Race condition mock. As noted above, the mock in `tests/helpers/rate-limit-mock.ts` fails to properly simulate asynchronous network latency, breaking concurrent test validity.
- **API Contract Drift**: Clean. `RateLimitResult` and 429 semantics remain structurally the same.
- **Data Model Mutations**: Clean. Moving from memory to Redis is safe, no migrations required.
- **Untagged Coupling & Lifecycle**: Clean.

**New Findings (only if clear evidence):**
- **Implicit Dependency (`@upstash/redis`)**: `app/api/lib/redis.ts` imports `Redis` from `@upstash/redis`, but `package.json` only adds `@upstash/ratelimit`. This works via npm hoisting but is brittle.

---

## Review — Tier 3: 2026-07-02

**Context:** Re-validation after P1 001/002, P2 003–005, and P3 006–008 fixes applied. 288 tests pass, lint clean. Five of seven original confirmed findings are now resolved; two are deferred or refuted.

**Validation Summary:** 5 resolved, 1 refuted (unchanged), 1 deferred (separate PR)

**Re-assessment of Original Findings:**

- **[Concurrent test runs sequentially not parallel]:** Resolved
  - **Evidence:** `tests/helpers/rate-limit-mock.ts:30` — shared mock now yields with `await new Promise(resolve => setImmediate(resolve))` before mutating state. Concurrent `Promise.all` tests now interleave via event loop.
  - **Notes:** Verified by test `"serializes concurrent same-identifier requests..."` passing.

- **[Blocked message field not asserted]:** Resolved
  - **Evidence:** `tests/rate-limit.test.ts` ("returns resetTime when blocked" test) — now asserts `blocked.message === "Too many requests. Please wait before trying again."` in addition to `allowed` and `resetTime`.
  - **Notes:** Full 429 response payload covered.

- **[ServiceError test checks name only]:** Resolved
  - **Evidence:** `tests/rate-limit.test.ts` — both error-path tests now assert `err instanceof Error && err.name === "ServiceError" && err.message === "Rate limit service unavailable"`. Checks `instanceof` + exact message, not just `.name`.
  - **Notes:** Two tests (reject path, timeout path) both validate the full error shape.

- **[TRUSTED_PROXIES never validates connecting peer]:** Deferred (P1 000)
  - **Evidence:** `app/api/tailor-cv/route.ts:30-48` — `parseClientIp` unchanged. The `TRUSTED_PROXIES` set is checked for the connecting peer IP, but there is no assertion that the immediate peer IS a trusted proxy before honoring `X-Forwarded-For`/`X-Real-IP`.
  - **Notes:** Captured in `todos/000-pending-p1-resolve-unknown-ip-global-bucket.md` as a fast-follow policy change. Not blocking this branch's merge.

- **[Default config collapses all clients into shared "unknown" bucket]:** Refuted (unchanged)
  - **Notes:** Deployment configuration concern, not a code regression. No change since original assessment.

- **[createSlidingWindowMock duplicated across test files]:** Resolved
  - **Evidence:** `tests/helpers/rate-limit-mock.ts` exports `createSlidingWindowMock`, `createFailingMock`, and `createTimeoutMock`. Both `tests/rate-limit.test.ts` and `tests/route.test.ts` import from this shared module. No inline mock implementations remain in either test file.
  - **Notes:** Also eliminates the third inline timeout mock (P3 006) via the new `createTimeoutMock` factory.

- **[Catch block discards underlying error]:** Resolved
  - **Evidence:** `app/api/lib/rate-limit.ts:102` — catch block now throws `new ServiceError("Rate limit service unavailable", { cause: error })`. Underlying Redis/Upstash exception preserved via `cause`.
  - **Notes:** Upstream `ServiceError` instances are correctly re-thrown (line 99), not wrapped.

- **[Implicit Dependency (`@upstash/redis`)]:** Resolved
  - **Evidence:** `package.json` declares both `@upstash/ratelimit: ^2.0.8` and `@upstash/redis: ^1.38.0` as direct dependencies. No longer relying on npm hoisting.
  - **Notes:** Dependency tree verified clean with `npm ls`.

**Spot-Check Results:**
- **Security & Auth**: TRUSTED_PROXIES XFF spoofing (P1 000) and "unknown" IP bucket both deferred to fast-follow. No new injection vectors, no unauthenticated access paths, all env vars validated. `__injectRatelimitForTest` and `resetRedisClientForTest` guarded by `NODE_ENV !== "test"`.
- **Supply Chain Risks**: Clean. Both `@upstash/ratelimit` and `@upstash/redis` are direct, scoped dependencies. No new unverified packages.
- **Error Handling & State Recovery**: `checkRateLimit` preserves cause; route handler maps RateLimitError→429, ServiceError→503, generic→500. Singleton re-creation on `null` injection works correctly. No swallowed exceptions.
- **Async / Concurrency**: Mock interleaves via `setImmediate`; concurrent `Promise.all` tests pass. No unhandled promise rejections, no sync code in async contexts.
- **API Contract Drift**: `RateLimitResult` unchanged. `checkRateLimit` JSDoc now documents `_sessionId` (forward-looking) and `identifier` parameters. No breaking changes.
- **Data Model Mutations**: No DB schema changes, no migrations. Redis key prefix configurable via `RATE_LIMIT_REDIS_PREFIX`.
- **Untagged Coupling & Lifecycle**: Singleton lifecycles tagged (`[SHARED-STATE]` on `getRatelimit()` and `getRedisClient()`). Test injection seams documented.

**New Findings:** None with clear unambiguous evidence not already tracked.
