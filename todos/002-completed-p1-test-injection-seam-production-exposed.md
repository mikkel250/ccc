---
status: completed
priority: p1
issue_id: "002"
tags: [code-review, security, architecture]
dependencies: []
---

# `__injectRatelimitForTest` export is production-exposed with no guard

## Problem Statement

`app/api/lib/rate-limit.ts:62-64` exports `__injectRatelimitForTest` which replaces the production `Ratelimit` singleton at runtime. There is no `NODE_ENV` check, no runtime guard, no conditional export. This test injection seam is callable in production.

While the function name has a `__` prefix and `ForTest` suffix suggesting it's test-only, nothing prevents:
1. A misconfigured dependency injection call from replacing the limiter
2. An accidental import and call from production code
3. A future developer who doesn't read the `__` convention

If called in production with `null`, the next `checkRateLimit()` call would reconstruct the real `Ratelimit` — this is recoverable but causes a dropped request. If called with a mock, all subsequent rate limiting is broken until the next `__injectRatelimitForTest(null)` + `checkRateLimit()` call.

## Findings

- **File:** `app/api/lib/rate-limit.ts:62-64` — `export function __injectRatelimitForTest(r: RatelimitLike | null): void`
- **No guard:** No `if (process.env.NODE_ENV !== 'test') throw ...` check
- **Precedent in codebase:** `app/api/lib/redis.ts:26-28` has `resetRedisClientForTest()` with the same issue
- **Comparative precedent:** `llm.ts` does NOT export a test injection seam — tests mock via `mock.method` on the deps bag
- **Risk:** Recoverable (null resets) but could cause dropped requests and confusing production behavior
- **The plan explicitly mentions this as an accepted deviation:** "Replaced with a single `__injectRatelimitForTest` injection seam... This adds 1 test-only export instead of the 6 removed"

## Proposed Solutions

### Option 1: Add NODE_ENV guard

**Approach:** Add a guard at the top of `__injectRatelimitForTest`:

```typescript
export function __injectRatelimitForTest(r: RatelimitLike | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__injectRatelimitForTest is only available in test environment");
  }
  ratelimit = r;
}
```

**Pros:**
- Production-safe — call in production throws immediately
- Clear error message
- Minimal change

**Cons:**
- Slightly more code (~3 lines)
- `NODE_ENV` must be set to `"test"` during test runs (it already is via `node --test`)

**Effort:** Trivial (5 min)

**Risk:** Low

---

### Option 2: Conditional export via build/bundler

**Approach:** Use a bundler or conditional require to strip test exports in production builds.

**Pros:**
- Test code physically absent from production bundle

**Cons:**
- Requires build tooling change (Next.js doesn't strip exports by default)
- Overengineered for this use case
- Fragile — depends on bundler configuration

**Effort:** Medium

**Risk:** Medium

---

### Option 3: Accept risk, document convention

**Approach:** Leave as-is. The `__` prefix is a well-known JavaScript convention for private/internal APIs. Document in CODE_CONVENTIONS.md that `__*ForTest` functions are test-only.

**Pros:**
- Zero code change
- Follows established JS community conventions

**Cons:**
- Convention-based safety, not enforced
- Can be violated accidentally

**Effort:** Trivial (documentation only)

**Risk:** Low (but residual production risk remains)

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `app/api/lib/rate-limit.ts:62-64` — primary target
- `app/api/lib/redis.ts:26-28` — same pattern, same fix needed

**Related:**
- `app/api/lib/llm.ts` — does NOT expose test seams; uses mock on deps bag pattern

## Resources

- **AGENTS.md rule:** "Handle errors at exactly one boundary" — production guard is a boundary concern
- **Plan deviation note:** `docs/plans/2026-06-12-feat-upstash-redis-rate-limit-plan.md` U2 "Deviation" section

## Acceptance Criteria

- [ ] `__injectRatelimitForTest` throws if called outside test environment (Option 1)
- [ ] `resetRedisClientForTest` similarly guarded
- [ ] `npm test` passes (NODE_ENV=test allows the call)
- [ ] `npm run lint` passes

## Work Log

### 2026-06-12 - Initial Discovery (Code Review)

**By:** Pi Code Review (security-sentinel, architecture-strategist)

**Actions:**
- Security-sentinel flagged production-exposed test injection seam
- Architecture-strategist noted deviation from llm.ts pattern (no test seams there)
- Pattern-recognition-specialist confirmed the `__` prefix convention is used but not enforced

**Learnings:**
- The plan (U2 Deviation) acknowledges this was an intentional tradeoff vs. `mock.method` on SDK internals
- `resetRedisClientForTest` in redis.ts has the same vulnerability
- `llm.ts` uses `mock.method` on the deps bag instead — but this doesn't work for ESM modules with own-property methods
