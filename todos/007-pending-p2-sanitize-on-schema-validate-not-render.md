---
status: done
priority: p2
issue_id: 007
tags: [code-review, data-integrity, security]
dependencies: []
---

# Sanitization Applied at Docx Render, Not at Schema Validation

## Acceptance Criteria

- [x] Curated JSON returned to caller has been sanitized (`sanitizeForResponse`)
- [x] Docx builder still sanitizes (defense in depth)
- [x] Route wires `sanitizeForResponse` through `tailorCvDeps`

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created | data-integrity-guardian |
| 2026-07-20 | Implemented | Route sanitizes before dual response |
| 2026-07-20 | Closed | Verified in `route.ts` + deps bag |
