---
status: completed
priority: p3
issue_id: "011"
tags: [code-review, simplicity, micro-optimization]
dependencies: []
---

# Simplify `parseClientIp` to avoid intermediate array allocations

## Resolution

**Closed.** Production code never implemented Option B (backward scan for any valid hop). `parseClientIp` now walks backward only to skip trailing empty segments, validates the **last non-empty** entry, and returns `"unknown"` when that entry is invalid — no fallback to earlier hops.

## Rejected: Option B (backward valid-IP scan)

Option B would weaken rightmost-XFF trust by returning an earlier valid hop when the final entry is invalid. That contradicts the anti-spoofing policy documented in `route.ts` and tested in `trusts the rightmost x-forwarded-for entry`.

## Implemented approach

```typescript
const entries = forwarded.split(",");
for (let i = entries.length - 1; i >= 0; i--) {
  const entry = entries[i]!.trim();
  if (!entry) continue;
  return isValidIp(entry) ? entry : "unknown";
}
```

Skips `.map().filter()` allocations; behavior matches the prior last-non-empty-entry logic.

## Acceptance Criteria

- [x] `parseClientIp` returns identical results for all existing test cases
- [x] Regression test: valid left + invalid right → 400 (no fallback)
- [x] `npm test` passes

## Work Log

### 2026-07-04 — Finding created

**By:** Multi-agent code review (code-simplicity-reviewer, performance-oracle)

### 2026-07-04 — Verified and closed

**By:** Code review follow-up

**Actions:** Confirmed Option B was todo-only, not deployed. Refactored to explicit last-non-empty-only validation; added anti-fallback regression test.

## Resources

- PR branch: `feature/rate-limit-unknown-ip-fastfollow`
