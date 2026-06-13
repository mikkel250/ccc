---
status: pending
priority: p3
issue_id: "007"
tags: [code-review, testing, quality]
dependencies: ["005"]
---

# Test `config` object duplicates env parsing in rate-limit.test.ts

## Problem Statement

`tests/rate-limit.test.ts:68-74` defines a `config` object with getter-based access that duplicates `getRateLimitConfig()` behavior:

```typescript
const config = {
  get maxRequests() {
    return parseInt(process.env.RATE_LIMIT_MAX || "5", 10);
  },
  get windowMs() {
    return parseInt(process.env.RATE_LIMIT_WINDOW || "60000", 10);
  },
};
```

Meanwhile, `getRateLimitConfig()` (from the module under test) does the same thing using `getEnvNumber()`. The test has its own `ensureEnv()` helper that sets up the env vars, and there's a test at line 293 that verifies `getRateLimitConfig()` returns the right values.

Using a different config source in the mock setup vs. the assertions creates a subtle coupling risk: if `getRateLimitConfig()` changes its implementation, the mock might use different values than the production code expects.

## Findings

- **File:** `tests/rate-limit.test.ts:68-74` — `config` object with getter-based env parsing
- **File:** `tests/rate-limit.test.ts:110-114` — config used to create mock window
- **File:** `tests/rate-limit.test.ts:293-299` — test that verifies `getRateLimitConfig()` returns correct values
- **Duplication:** The `parseInt(process.env.RATE_LIMIT_MAX || "5", 10)` logic duplicates `getEnvNumber("RATE_LIMIT_MAX", 5)` in `lib/env.ts`
- **Risk:** Low — the test also verifies `getRateLimitConfig()` output, providing a cross-check

## Proposed Solutions

### Option 1: Use `getRateLimitConfig()` directly in mock setup

**Approach:** Replace the `config` object with calls to `getRateLimitConfig()`:

```typescript
beforeEach(() => {
  ensureEnv();
  resetRedisClientForTest();
  const cfg = getRateLimitConfig();
  __injectRatelimitForTest(
    createSlidingWindowMock({
      maxRequests: cfg.maxRequests,
      windowMs: cfg.windowMs,
    }) as any
  );
});
```

And update the `config.maxRequests` / `config.windowMs` references in test bodies to use `getRateLimitConfig()`.

**Pros:**
- Single source of truth — mock uses same config as production
- No env parsing duplication
- Test verifies the exact same config path

**Cons:**
- Slightly more verbose in each test (need `getRateLimitConfig()` call)
- `getRateLimitConfig()` calls are already cheap (module-level constants)

**Effort:** Small (15 min)

**Risk:** Low

---

### Option 2: Leave as-is with a comment

**Approach:** Add a comment explaining that the `config` object intentionally mirrors production config for isolation, and that the `getRateLimitConfig` test at line 293 serves as a cross-check.

**Pros:**
- Zero change
- Test config is isolated from production config implementation

**Cons:**
- Maintains duplication
- Doesn't fix the underlying issue

**Effort:** Trivial (1 min)

**Risk:** None

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `tests/rate-limit.test.ts:68-74` — `config` object

## Resources

- **AGENTS.md:** "80% overlap means extend, don't copy"
- **Related P2:** `todos/005-pending-p2-duplicate-sliding-window-mock-tests.md`

## Acceptance Criteria

- [ ] Mock config uses `getRateLimitConfig()` instead of duplicating env parsing
- [ ] All tests pass with same assertions
- [ ] `npm test` passes

## Work Log

### 2026-06-12 - Initial Discovery (Code Review)

**By:** Pi Code Review (code-simplicity-reviewer, pattern-recognition-specialist)

**Actions:**
- Code-simplicity-reviewer flagged config duplication
- Pattern-recognition-specialist confirmed the test has a cross-check assertion

**Learnings:**
- The cross-check test at line 293 mitigates but doesn't eliminate the risk
- The `config` object pattern is common in test files — it's not necessarily wrong, just duplication-prone
