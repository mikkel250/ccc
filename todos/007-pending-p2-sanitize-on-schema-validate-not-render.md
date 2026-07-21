---
status: ready
priority: p2
issue_id: 007
tags: [code-review, data-integrity, security]
dependencies: []
---

# Sanitization Applied at Docx Render, Not at Schema Validation

## Problem Statement

`sanitizeCvJson()` is applied inside `buildJsonDocxBase64()` (the docx builder). However, the route handler returns `curatedJson` (schema-validated but not sanitized) directly to the caller. Free-text fields from the curator LLM that contain disallowed control characters or other injection-adjacent content are sanitized in the `.docx` but returned verbatim in the JSON response. The caller receiving unsanitized JSON is a data integrity concern.

## Findings

- **Location:** `app/api/tailor-cv/route.ts` — `schemaResult.data` is returned as `curatedJson` without sanitization; sanitization only happens inside `json-docx-builder.ts`
- **Evidence:** Route returns `curatedJson: schemaResult.data` on line ~148. The `buildJsonDocxBase64` function calls `sanitizeCvJson(data)` before rendering, but that sanitized copy is not returned to the caller.

## Proposed Solutions

1. **Sanitize before returning curated JSON:** Call `sanitizeCvJson()` on the schema-validated data before including it in the response. The docx builder should receive already-sanitized data.
   - Pros: Single sanitization point; both outputs consistent
   - Cons: Requires moving sanitize into route handler or post-validation step
   - Effort: Small
   - Risk: Low

2. **Return sanitized copy from docx builder:** Have `buildJsonDocxBase64` also return the sanitized data used for rendering.
   - Pros: No extra sanitize call
   - Cons: Mixes concerns (docx builder returning JSON); odd API
   - Effort: Small
   - Risk: Low

## Recommended Action

Solution 1.

## Technical Details

- **Affected files:** `app/api/tailor-cv/route.ts`, `app/api/lib/json-docx-builder.ts`
- **Affected components:** Response construction, docx builder
- **No database changes**
- **No API changes** (same response shape, just sanitized strings)

## Acceptance Criteria

- [ ] Curated JSON returned to caller has been sanitized (control characters stripped)
- [ ] Docx builder receives already-sanitized data or re-sanitizes (defense in depth)
- [ ] Tests verify sanitization of response JSON, not just docx

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | Flagged by data-integrity-guardian |
| 2026-07-20 | Implemented | Added `sanitizeForResponse` through deps bag; route handler sanitizes curatedJson before response |

## Resources

- Source: `app/api/tailor-cv/route.ts`, `app/api/lib/json-docx-builder.ts`
