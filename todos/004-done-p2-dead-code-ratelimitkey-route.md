---
status: done
priority: p2
issue_id: "004"
tags: [code-review, quality, simplicity]
dependencies: []
---

# Dead code: `rateLimitKey` computed but unused in route.ts

## Problem Statement

`app/api/tailor-cv/route.ts:61` computes `rateLimitKey` as `${sessionId}:${ipAddress}` and passes it as the first argument to `checkRateLimit()`:

```typescript
const rateLimitKey = `${sessionId}:${ipAddress}`;
const rateLimit = await tailorCvDeps.checkRateLimit(rateLimitKey, ipAddress);
```

However, `checkRateLimit`'s first parameter is `_sessionId: string` — prefixed with `_` indicating intentionally unused. The real rate-limit key is the second parameter `identifier` (the IP address).

This means:
1. `rateLimitKey` is computed but never used for rate limiting
2. The variable name suggests it's the rate limit key (misleading)
3. The string interpolation `${sessionId}:${ipAddress}` is wasted work on every request

The `_sessionId` parameter is reserved for future auth integration (per the plan). The route should either:
- Not compute `rateLimitKey` at all (pass `sessionId` directly as the first arg)
- Or acknowledge correctly that the rate limit is keyed on IP only

## Findings

- **File:** `app/api/tailor-cv/route.ts:61-62` — `rateLimitKey` computed but unused for rate limiting
- **File:** `app/api/lib/rate-limit.ts:67` — `_sessionId: string` with underscore prefix = intentionally unused
- **Plan context:** `docs/plans/2026-06-12-feat-upstash-redis-rate-limit-plan.md` — "sessionId is accepted for future auth integration; limiting is keyed on the identifier argument"
- **Impact:** Minor performance waste (string interpolation per request) and misleading variable name
- **The existing comment at rate-limit.ts:4-7 correctly documents this:** "sessionId is accepted for future auth integration; limiting is keyed on the identifier argument"

## Proposed Solutions

### Option 1: Pass sessionId and IP separately, rename rateLimitKey

**Approach:** Remove the `rateLimitKey` variable. Pass `sessionId` and `ipAddress` as separate arguments:

```typescript
const rateLimit = await tailorCvDeps.checkRateLimit(sessionId, ipAddress);
```

**Pros:**
- Clear, minimal, no wasted computation
- Directly matches the function signature intent
- No misleading variable names

**Cons:**
- None

**Effort:** Trivial (2 min)

**Risk:** None

---

### Option 2: Add comment explaining future intent

**Approach:** Keep the code as-is but add a comment explaining that `rateLimitKey` is computed for future per-user rate limiting and currently unused.

**Pros:**
- Documents intent
- Avoids breaking any code that depends on the `rateLimitKey` variable (none found)

**Cons:**
- Still wastes computation
- Still misleading name

**Effort:** Trivial (1 min)

**Risk:** None

## Recommended Action

**To be filled during triage.** Option 1 preferred — simplifies the code and removes the confusion.

## Technical Details

**Affected files:**
- `app/api/tailor-cv/route.ts:61-62` — primary target
- `app/api/lib/rate-limit.ts:67` — `_sessionId` parameter (no change needed, correctly documented)

## Resources

- **Plan:** `docs/plans/2026-06-12-feat-upstash-redis-rate-limit-plan.md` — "Flexible key" section
- **AGENTS.md:** "Code Simplicity" — YAGNI

## Acceptance Criteria

- [x] `rateLimitKey` variable removed, passes `sessionId` directly
- [x] All existing tests pass
- [x] `npm run lint` passes

## Work Log

### 2026-06-12 - Initial Discovery (Code Review)

**By:** Pi Code Review (code-simplicity-reviewer, architecture-strategist)

**Actions:**
- Code-simplicity-reviewer flagged `rateLimitKey` as dead code
- Architecture-strategist confirmed the `_sessionId` parameter convention is correct per the plan
- Pattern-recognition-specialist noted the variable name is misleading

**Learnings:**
- The plan explicitly states this is forward-looking API design
- The `_` prefix is a well-known TypeScript convention for intentionally unused parameters
