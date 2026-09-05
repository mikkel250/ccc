---
status: done
priority: p3
issue_id: 009
tags: [code-review, typescript]
dependencies: []
---

# Unused Generic on `sanitizeCvJson`

## Acceptance Criteria

- [x] `sanitizeCvJson` signature is `(value: unknown): unknown` (no unconstrained generic)
- [x] TypeScript / lint pass with downstream callers

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created | typescript reviewer |
| 2026-07-20 | Implemented | Removed generic |
| 2026-07-20 | Closed | Verified signature + callers |
