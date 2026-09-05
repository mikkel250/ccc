---
status: done
priority: p2
issue_id: 006
tags: [code-review, security]
dependencies: []
---

# Error Stack Traces Logged in Production

## Acceptance Criteria

- [x] Stack traces not logged when `NODE_ENV=production`
- [x] Stack traces still logged in dev/test for debugging
- [x] Error name and message always logged

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created | security-sentinel |
| 2026-07-20 | Implemented | `safeTailorLog` omits `stack` when production |
| 2026-07-20 | Closed | Verified in `route.ts` |
