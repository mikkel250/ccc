---
status: ready
priority: p2
issue_id: 005
tags: [code-review, security, performance]
dependencies: []
---

# `parseClientIp` Iterates Right-to-Left with No Hard Limit on `x-forwarded-for` Entries

## Problem Statement

`parseClientIp()` in `route.ts` splits `x-forwarded-for` and iterates from the rightmost entry, trying each until a valid IP is found. There is no hard cap on the number of entries processed. An attacker could send thousands of comma-separated invalid entries followed by a valid IP, causing excessive CPU work per request before rate limiting.

## Findings

- **Location:** `app/api/tailor-cv/route.ts`, function `parseClientIp()`
- **Evidence:** The function splits on `,` and loops `for (let i = entries.length - 1; i >= 0; i--)` with no cap on entries. The header has no size limit enforced.
- **Impact:** Low — this happens before body read but after auth, and the `x-forwarded-for` header is typically set by the proxy, not the client. However, if the header is attacker-controlled (possible in some proxy configurations), this could be a CPU exhaustion vector.

## Proposed Solutions

1. **Cap entries processed:** Only check the rightmost N entries (e.g., 5). If no valid IP found after N, return "unknown".
   - Pros: Constant-time; eliminates vector
   - Cons: Edge case with many legitimate proxies (unlikely for this app's deployment model)
   - Effort: Small
   - Risk: Very low

2. **Only check the rightmost entry:** The rightmost entry is the one appended by the nearest proxy — this is sufficient for Railway's proxy setup.
   - Pros: Simplest; O(1)
   - Cons: Slightly less robust if proxy chain depth changes
   - Effort: Small
   - Risk: Very low

## Recommended Action

Solution 2 — check only the rightmost entry.

## Technical Details

- **Affected files:** `app/api/tailor-cv/route.ts`
- **Affected components:** IP resolution
- **No database changes**
- **No API changes**

## Acceptance Criteria

- [ ] `parseClientIp` has a bounded number of entries it examines
- [ ] Valid IP from a standard proxy chain is correctly identified
- [ ] Malformed/attack header returns "unknown" without excessive work

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | Flagged by security-sentinel, adversarial-reviewer |
| 2026-07-20 | Implemented | Capped x-forwarded-for entries to rightmost 5 via `MAX_XFF_ENTRIES` constant |

## Resources

- Source: `app/api/tailor-cv/route.ts`
