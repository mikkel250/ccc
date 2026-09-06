---
status: done
priority: p2
issue_id: "016"
tags: [code-review, performance, latency]
dependencies: []
---

# Serial Redis rate-limit calls add avoidable latency to critical path

## Problem Statement

`app/api/lib/rate-limit.ts:checkRateLimit()` makes two sequential Redis calls:

```typescript
const secretResult = await runLimit(secretRl, secretBucketKey);
if (!secretResult.allowed) {
  return secretResult;
}
const ipResult = await runLimit(ipRl, ipIdentifier);
return moreRestrictive(ipResult, secretResult);
```

The IP check waits for the secret check to complete before starting. While the early-return on secret exhaustion is correct (avoids burning IP quota), the common case (both allowed) incurs ~50-100ms of unnecessary serial latency from the second Redis round-trip.

## Findings

- **File:** `app/api/lib/rate-limit.ts:122-129` — sequential `await` on two independent Redis calls
- **Impact:** Adds ~50-100ms to every successful tailor request
- **Design note:** The early-return optimization for denied secret buckets is correct and should be preserved
- **Common case:** Both buckets are normally allowed → IP check waits needlessly

## Proposed Solutions

### Option A: Parallelize with Promise.all and post-hoc deny check
- **Effort:** Small
- **Risk:** Low
- **Pros:** Reduces latency in common case; still handles denied buckets correctly
- **Cons:** Makes two Redis calls even when secret would deny (wastes one Redis call)
- **Approach:**
  ```typescript
  const [secretResult, ipResult] = await Promise.all([
    runLimit(secretRl, secretBucketKey),
    runLimit(ipRl, ipIdentifier),
  ]);
  if (!secretResult.allowed) return secretResult;
  return moreRestrictive(ipResult, secretResult);
  ```

### Option B: Keep sequential with comment
- **Effort:** Trivial
- **Risk:** None
- **Pros:** No code change; saves one Redis call when secret bucket is exhausted
- **Cons:** Leaves ~50-100ms on the table in the common case
- **Approach:** Add comment explaining the latency tradeoff

## Technical Details

- **Affected files:** `app/api/lib/rate-limit.ts`
- **Components:** Upstash Redis rate limiter
- **Database changes:** None

## Acceptance Criteria

- [x] Decision recorded: keep sequential (Option B) — secret-first prevents IP quota burn per R21
- [x] Comment added explaining ~50ms latency tradeoff
- [x] All rate-limit tests pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-22 | Created from code review | performance-oracle |
| 2026-07-22 | Resolved — documented | Added comment documenting intentional sequential design. Parallelizing would break the "does not consume IP quota when secret bucket alone denies" invariant per R21. |

## Resources

- File: `app/api/lib/rate-limit.ts`
- Tests: `tests/rate-limit.test.ts`
