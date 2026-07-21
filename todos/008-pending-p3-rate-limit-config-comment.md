---
status: ready
priority: p3
issue_id: 008
tags: [code-review, config]
dependencies: []
---

# `RATE_LIMIT_SECRET_MAX` Default Should Be Documented in Code Comment

## Problem Statement

`RATE_LIMIT_SECRET_MAX` defaults to `Math.max(1, Math.floor(RATE_LIMIT_MAX / 2))` when unset. This means the secret-specific ceiling is half the IP ceiling by default. This relationship (secret ≤ IP cap) is correct behavior but is non-obvious — a comment would help future maintainers understand the rationale.

## Findings

- **Location:** `app/api/lib/rate-limit.ts`, line ~14
- **Evidence:** The default derivation uses a nested `Math.max(Math.floor(...))` which is opaque. The intent (secret bucket should have a lower ceiling than IP bucket to prevent key sharing abuse) is sound but undocumented.

## Proposed Solutions

1. **Add a comment explaining the relationship:**
   ```
   // Default half the per-IP cap so secret sharing can't inflate overall throughput.
   const RATE_LIMIT_SECRET_MAX = Math.max(1, ...);
   ```
   - Pros: Obvious fix
   - Cons: None
   - Effort: Trivial
   - Risk: None

## Recommended Action

Add comment.

## Technical Details

- **Affected files:** `app/api/lib/rate-limit.ts`
- **No behavior change**
- **No API changes**
- **No test changes**

## Acceptance Criteria

- [ ] Comment explains why secret max defaults to IP max / 2

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | Flagged by code-simplicity-reviewer |
| 2026-07-20 | Implemented | Added comment explaining secret-max default derives from per-IP cap |

## Resources

- Source: `app/api/lib/rate-limit.ts`
