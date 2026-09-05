---
status: done
priority: p2
issue_id: 005
tags: [code-review, security, performance]
dependencies: []
---

# `parseClientIp` XFF Entry Cap

## Acceptance Criteria

- [x] `parseClientIp` examines at most `MAX_XFF_ENTRIES` (5) rightmost entries
- [x] Valid IP from a standard proxy chain is correctly identified
- [x] Oversized/malformed XFF returns `"unknown"` without unbounded work

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created | security-sentinel / adversarial |
| 2026-07-20 | Implemented | `MAX_XFF_ENTRIES = 5` in `route.ts` |
| 2026-07-20 | Closed | Verified control present |
