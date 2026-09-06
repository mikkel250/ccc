---
status: cancelled
priority: p2
issue_id: 003
tags: [code-review, architecture, simplicity]
dependencies: []
---

# `tailor-cv-deps.ts` Indirection Layer

## Recommended Action (accepted)

**Retain** `tailorCvDeps` in `app/api/lib/tailor-cv-deps.ts` for ESM namespace mockability. Route tests use `mock.method(tailorCvDeps, …)` because Node cannot intercept ESM export bindings. Do **not** delete or inline the bag for direct route imports unless the test strategy changes.

## Acceptance Criteria

- [x] Architectural decision recorded: keep deps bag for test injection
- [x] Module header documents the ESM mockability rationale
- [x] No requirement to remove `tailor-cv-deps.ts` while that test strategy stands

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created | simplicity/architecture reviewers suggested removal |
| 2026-07-20 | Cancelled | Keep bag; document ESM mockability |
