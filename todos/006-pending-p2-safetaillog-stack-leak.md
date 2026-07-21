---
status: ready
priority: p2
issue_id: 006
tags: [code-review, security]
dependencies: []
---

# Error Stack Traces Logged in Production for Non-Curator Errors

## Problem Statement

`safeTailorLog()` in `route.ts` logs `error.stack` when `error instanceof Error` for *all* error types, not just curator/output errors. While the function correctly avoids logging master/curated/JD payloads, logging full stack traces in production is a security hygiene issue — internal paths, line numbers, and module names can leak deployment topology.

## Findings

- **Location:** `app/api/tailor-cv/route.ts`, function `safeTailorLog()`
- **Evidence:** The function always logs `error.stack` for Error instances. The catch block on line ~176 calls `safeTailorLog("Tailor CV API error:", error)` — this fires for *any* unhandled exception including auth failures, rate-limit timeouts, JSON parse errors from untrusted input, etc.
- **Severity:** P2 — not a critical data leak (no PII), but stacks in production logs are an anti-pattern that should be controlled.

## Proposed Solutions

1. **Only log stacks in non-production:** Check `NODE_ENV !== "production"` (or `isProductionLikeDeploy()`) before logging `error.stack`.
   - Pros: Simple guard; standard practice
   - Cons: Debugging production issues becomes harder
   - Effort: Trivial
   - Risk: Very low

2. **Use structured logging with separate fields:** Log `error.message` always, `error.stack` only in dev.
   - Pros: Fine-grained control
   - Cons: More code
   - Effort: Small
   - Risk: Very low

## Recommended Action

Solution 1.

## Technical Details

- **Affected files:** `app/api/tailor-cv/route.ts`
- **Affected components:** Error logging
- **No database changes**
- **No API changes**

## Acceptance Criteria

- [ ] Stack traces not logged when `NODE_ENV=production`
- [ ] Stack traces still logged in dev/test for debugging
- [ ] Error name and message always logged

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | Flagged by security-sentinel |
| 2026-07-20 | Implemented | Stack traces only logged when NODE_ENV !== "production" |

## Resources

- Source: `app/api/tailor-cv/route.ts`
