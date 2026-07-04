---
status: done
priority: p2
issue_id: "005"
tags: [code-review, quality, testing, simplicity]
dependencies: []
---

# Duplicate sliding window mock logic between rate-limit.test.ts and route.test.ts

## Problem Statement

Two test files implement nearly identical sliding window mock behavior:

1. **`tests/rate-limit.test.ts`** — `createSlidingWindowMock()` function (~40 lines, lines 18-57)
2. **`tests/route.test.ts`** — `injectSlidingWindowMock()` function (~25 lines, lines 29-54)

Both functions:
- Maintain an in-memory `Map<string, number[]>` of timestamps per identifier
- Filter expired timestamps using `windowMs`
- Track `oldest` timestamp for `reset` calculation
- Return `{ success, remaining, reset, limit, pending }` in the same shape

The `route.test.ts` version is a simplified copy. The `rate-limit.test.ts` version has a `createFailingMock()` companion.

This violates AGENTS.md: **"80% overlap means extend, don't copy."** The two implementations overlap by ~90%.

## Findings

- **File:** `tests/rate-limit.test.ts:18-57` — `createSlidingWindowMock()`
- **File:** `tests/rate-limit.test.ts:59-64` — `createFailingMock()`
- **File:** `tests/route.test.ts:29-54` — `injectSlidingWindowMock()`
- **Overlap:** ~90% — both create a sliding window mock, differ only in how they're wired into `__injectRatelimitForTest`
- **Line count:** ~65 lines of near-duplicate test infrastructure
- **Risk:** If the mock behavior changes, both files must be updated independently (drift risk)

## Proposed Solutions

### Option 1: Extract to shared test helper module

**Approach:** Create `tests/helpers/rate-limit-mock.ts` exporting:

```typescript
export function createSlidingWindowMock(config: { maxRequests: number; windowMs: number }): RatelimitLike
export function createFailingMock(): RatelimitLike
```

Both test files import from the shared helper. Remove the inline implementations.

**Pros:**
- Single source of truth
- Mock behavior changes in one place
- Smaller test files (focus on assertions, not infrastructure)
- Follows existing pattern: the codebase has a `tests/` directory where shared helpers would fit

**Cons:**
- Adds one new test helper file
- Tests become slightly less self-contained

**Effort:** Small (30 min)

**Risk:** Low

---

### Option 2: Remove route.test.ts mock, use mock.method on checkRateLimit

**Approach:** Instead of injecting a mock Ratelimit into route.test.ts, mock `tailorCvDeps.checkRateLimit` directly using `mock.method` (pattern already used in route.test.ts for other deps).

```typescript
mock.method(tailorCvDeps, "checkRateLimit", async () => ({
  allowed: true, remaining: 4, resetTime: Date.now() + 60000
}));
```

**Pros:**
- No duplicate mock — mocks at the deps bag level (consistent with existing test patterns)
- No need for `__injectRatelimitForTest` in route tests at all
- Follows the existing `mock.method(tailorCvDeps, ...)` pattern used throughout route.test.ts

**Cons:**
- The rate limit blocking test (429) needs a more nuanced mock that tracks state — but can be handled with a simple closure counter
- Slightly changes the test approach (mock at dep level vs SDK level)

**Effort:** Small (20 min)

**Risk:** Low

## Recommended Action

**To be filled during triage.** Option 1 is simpler and keeps the mock at the correct abstraction level. Option 2 is more aligned with existing test patterns in the file.

## Technical Details

**Affected files:**
- `tests/rate-limit.test.ts:18-64` — extract `createSlidingWindowMock`, `createFailingMock`
- `tests/route.test.ts:29-54` — replace inline mock with shared import
- `tests/helpers/rate-limit-mock.ts` (new) — shared mock factory

## Resources

- **AGENTS.md:** "80% overlap means extend, don't copy"
- **Existing pattern:** `tests/route.test.ts` already uses `mock.method(tailorCvDeps, ...)` for other deps

## Acceptance Criteria

- [x] Only one implementation of sliding window mock exists (`tests/helpers/rate-limit-mock.ts`)
- [x] Both test files import from shared source
- [x] All existing tests pass with the same assertions
- [x] `npm test` passes
- [x] `npm run lint` passes

## Work Log

### 2026-06-12 - Initial Discovery (Code Review)

**By:** Pi Code Review (code-simplicity-reviewer, pattern-recognition-specialist)

**Actions:**
- Code-simplicity-reviewer flagged duplicate mock infrastructure
- Pattern-recognition-specialist confirmed the two implementations are 90% overlapping
- Measured line counts: ~65 lines total, could be ~40 lines shared + imports

**Learnings:**
- The route.test.ts mock was likely copied from rate-limit.test.ts during initial implementation
- Route.test.ts already uses `mock.method(tailorCvDeps, ...)` for other pipeline steps — the Ratelimit mock is the only one that bypasses the deps bag
