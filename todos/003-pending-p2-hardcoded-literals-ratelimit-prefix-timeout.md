---
status: done
priority: p2
issue_id: "003"
tags: [code-review, architecture, standards]
dependencies: ["001"]
---

# Hardcoded literals `prefix: "ratelimit"` and `timeout: 0` violate AGENTS.md

## Problem Statement

AGENTS.md states: **"Every literal value is a future outage. Numbers, strings, URLs, timeouts, TTLs — if it is not a language keyword, it goes in `process.env` with a sensible default."**

Two literals in `getRatelimit()` violate this rule:

1. **`prefix: "ratelimit"`** (line 46) — The Redis key prefix. If changed, all existing rate-limit state is orphaned. Being configurable allows key migration without code deploys.
2. **`timeout: 0`** (line 49) — Already flagged as P1 in issue #001. The same env var (`RATE_LIMIT_TIMEOUT_MS`) would satisfy both issues.

Both follow the same pattern as `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW` which are already env-var-driven — the inconsistency within the same module is notable.

## Findings

- **File:** `app/api/lib/rate-limit.ts:46` — `prefix: "ratelimit"` hardcoded
- **File:** `app/api/lib/rate-limit.ts:49` — `timeout: 0` hardcoded
- **Contrast:** `app/api/lib/rate-limit.ts:14-15` — `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` both use `getEnvNumber()` with defaults
- **AGENTS.md citation:** "Every literal value is a future outage" under "Senior Engineer Heuristics"
- **`.env.example`:** Would need entries for `RATE_LIMIT_REDIS_PREFIX` and `RATE_LIMIT_TIMEOUT_MS`

## Proposed Solutions

### Option 1: Env-var all the things

**Approach:** Add two env vars with sensible defaults:

```typescript
const RATE_LIMIT_REDIS_PREFIX = getEnvString("RATE_LIMIT_REDIS_PREFIX", "ratelimit") ?? "ratelimit";
const RATE_LIMIT_TIMEOUT_MS = getEnvNumber("RATE_LIMIT_TIMEOUT_MS", 2000);
```

Use in `getRatelimit()`:
```typescript
ratelimit = new Ratelimit({
  redis: getRedisClient(),
  limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, `${RATE_LIMIT_WINDOW_MS} ms`),
  prefix: RATE_LIMIT_REDIS_PREFIX,
  timeout: RATE_LIMIT_TIMEOUT_MS,
});
```

**Pros:**
- Full AGENTS.md compliance
- Tunable per environment
- Consistent with module's own pattern (lines 14-15)

**Cons:**
- Two more env vars in already-growing catalog
- `prefix` is unlikely to change in practice (deploy-time only config)

**Effort:** Small (20 min)

**Risk:** Low

---

### Option 2: Timeout only, keep prefix hardcoded

**Approach:** Only env-var `timeout` (already needed for P1 issue #001). Keep `prefix` hardcoded — it's a deploy-time constant that never changes per environment.

**Pros:**
- Fixes the actual reliability issue (timeout) without adding cosmetic env vars
- Prefix is genuinely a deployment constant

**Cons:**
- Partial AGENTS.md compliance
- If prefix ever needs changing, requires code deploy

**Effort:** Small (10 min)

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `app/api/lib/rate-limit.ts:44-50` — `getRatelimit()` function
- `.env.example` — add entries if Option 1 chosen

## Resources

- **AGENTS.md:** "Config-driven routing, code-driven integration" section
- **AGENTS.md:** "Senior Engineer Heuristics" — "Every literal value is a future outage"
- **Related P1:** `todos/001-pending-p1-ratelimit-timeout-zero-unbounded-wait.md`

## Acceptance Criteria

- [x] `timeout` driven by env var (addressing P1 issue #001)
- [x] `prefix` env-var-driven
- [x] `.env.example` updated with `RATE_LIMIT_REDIS_PREFIX`
- [x] `npm test` passes
- [x] `npm run lint` passes

## Work Log

### 2026-06-12 - Initial Discovery (Code Review)

**By:** Pi Code Review (project-standards-reviewer, code-simplicity-reviewer)

**Actions:**
- Project-standards-reviewer flagged hardcoded literals as AGENTS.md violation
- Code-simplicity-reviewer noted inconsistency with same module's RATE_LIMIT_MAX pattern
- Pattern-recognition-specialist confirmed this is the only module with mixed env-var + hardcoded config

**Learnings:**
- The existing `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` already establish the correct pattern at lines 14-15
- The mixed approach (some env vars, some hardcoded) within 30 lines of the same module violates consistency
