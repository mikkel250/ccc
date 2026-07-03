---
status: completed
priority: p3
issue_id: "006"
tags: [code-review, typescript, testing, quality]
dependencies: []
---

# Replace `as any` casts in test mocks with proper types

## Problem Statement

Five `as any` type assertions appear across test files where mock objects don't satisfy the full `RatelimitLike` interface. These bypass TypeScript's type checker, meaning:

1. If the `RatelimitLike` interface changes (e.g., new required property), tests won't catch the mismatch
2. Mock objects may be missing properties that the production code expects
3. TypeScript can't verify the mock's `limit()` signature matches the real `Ratelimit.limit()`

Locations:
- `tests/rate-limit.test.ts:113` — `createSlidingWindowMock(...) as any`
- `tests/rate-limit.test.ts:156` — `createFailingMock() as any`
- `tests/rate-limit.test.ts:163-173` — inline mock with `as const` + implicit `as any`
- `tests/route.test.ts:52` — `} as any`
- `tests/route.test.ts:125-128` — `} as any`

## Findings

- **File:** `tests/rate-limit.test.ts:113` — `createSlidingWindowMock(...) as any` in `beforeEach`
- **File:** `tests/rate-limit.test.ts:156` — `createFailingMock() as any`
- **File:** `tests/rate-limit.test.ts:163-173` — timeout mock with `reason: "timeout" as const`
- **File:** `tests/route.test.ts:52` — inline mock `} as any`
- **File:** `tests/route.test.ts:125-128` — failing mock `} as any`
- **Root cause:** `RatelimitLike` is `Pick<Ratelimit, "limit">` but the mock objects have a different `limit` signature (not a method on a class instance, just an async function)
- **Why `as any` is used:** The mocks implement `{ limit: (identifier: string) => Promise<...> }` but the real `Ratelimit.limit` may have additional overloads or a different `this` binding

## Proposed Solutions

### Option 1: Define a proper RatelimitMock type and use `satisfies`

**Approach:** Define a `RatelimitMock` interface that matches the subset of `RatelimitLike` needed for tests:

```typescript
interface RatelimitMock {
  limit(identifier: string): Promise<{
    success: boolean;
    remaining: number;
    reset: number;
    limit: number;
    pending: Promise<unknown>;
    reason?: "timeout";
  }>;
}
```

Use `satisfies RatelimitMock` instead of `as any`:

```typescript
__injectRatelimitForTest(
  createSlidingWindowMock(...) satisfies RatelimitMock as RatelimitLike
);
```

**Pros:**
- Type-safe — TypeScript verifies mock shape
- Single cast at the boundary (mock → RatelimitLike) instead of per-mock `as any`
- Tests fail at compile time if mock interface drifts

**Cons:**
- Still needs one `as RatelimitLike` cast at the injection point
- Adds ~10 lines of type definition

**Effort:** Small (20 min)

**Risk:** Low

---

### Option 2: Use `mock.method` on a real Ratelimit instance

**Approach:** Create a real (but unconnected) Ratelimit instance and mock its `limit` method:

```typescript
const rl = new Ratelimit({ redis: mockRedis, limiter: Ratelimit.slidingWindow(5, "60 s"), prefix: "test" });
mock.method(rl, "limit", mockLimitFn);
```

**Pros:**
- Zero `as any` casts — mock.method preserves types
- Uses the real Ratelimit type

**Cons:**
- Requires a mock Redis client (avoids real network calls)
- More setup boilerplate
- `new Ratelimit()` constructor may have side effects

**Effort:** Medium (45 min)

**Risk:** Medium (constructor side effects unknown)

---

### Option 3: Accept `as any` as a pragmatic tradeoff (no change)

**Approach:** Document that `as any` in test mocks is intentional — the mock objects implement the contract but TypeScript can't verify structural compatibility with the third-party SDK's class-based API. Add a comment explaining the rationale.

**Pros:**
- Zero effort
- Common pattern in TypeScript test suites

**Cons:**
- No type safety for mock objects
- Interface drift won't be caught

**Effort:** Trivial (2 min)

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `tests/rate-limit.test.ts:113,156,163-173`
- `tests/route.test.ts:52,125-128`

## Resources

- **AGENTS.md:** "External data is `unknown` until validated" — not directly applicable to test mocks but same principle
- **Kieran TypeScript reviewer:** Flagged `as any` as a type safety concern

## Acceptance Criteria

- [ ] All `as any` casts in test mocks replaced with proper types or a documented rationale
- [ ] Tests still pass with same assertions
- [ ] `npm test` passes
- [ ] `npm run lint` passes

## Work Log

### 2026-06-12 - Initial Discovery (Code Review)

**By:** Pi Code Review (kieran-typescript-reviewer, security-sentinel)

**Actions:**
- Kieran TypeScript reviewer flagged all 5 `as any` casts
- Security-sentinel confirmed no production impact (test-only code)
- Pattern-recognition-specialist noted `as any` is used nowhere else in the production code

**Learnings:**
- The `RatelimitLike` type (`Pick<Ratelimit, "limit">`) should be sufficient but class method signatures vs plain function signatures differ in TypeScript
- The real solution is defining a proper mock interface that satisfies structural typing

### 2026-07-02 - Resolved (Option 1, derived-type variant)

**By:** Work execution agent

**Actions:**
- `tests/helpers/rate-limit-mock.ts` now exports `RatelimitResponse`/`RatelimitLike` derived via `Awaited<ReturnType<Ratelimit["limit"]>>` and `Pick<Ratelimit, "limit">` from the real SDK type — no hand-duplicated shape to drift.
- `createSlidingWindowMock`, `createFailingMock` now return `RatelimitLike` directly; added `createTimeoutMock()` factory (dedupes the third inline mock, addressing overlap with #005).
- Removed all 5 `as any` casts across `tests/rate-limit.test.ts` and `tests/route.test.ts` — mocks are structurally assignable to `__injectRatelimitForTest`'s parameter with zero casts.
- `npm test` (292 tests, 288 pass / 4 pre-existing skips) and `npm run lint` both pass.
