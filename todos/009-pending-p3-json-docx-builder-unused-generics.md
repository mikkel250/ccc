---
status: ready
priority: p3
issue_id: 009
tags: [code-review, typescript]
dependencies: []
---

# Unused Generic Type Parameters and Over-generic Signatures in `json-docx-builder.ts`

## Problem Statement

The `sanitizeCvJson<T>` function is generic but `T` is never constrained or inferred meaningfully — callers always get `unknown` back from the route pipeline. The generic adds surface area with no type safety benefit. Several other builder functions (`applyTextStyles`, `makeStyledParagraph`) have parameter types that could be more specific.

## Findings

- **Location:** `app/api/lib/json-docx-builder.ts` — `sanitizeCvJson<T>(value: T): T`
- **Evidence:** The generic is unused at the call site (called with `schemaResult.data` which is `unknown`). The return type `T` is a lie — if `T` is `string`, `sanitizeCvJson("hello")` returns `string`, but if `T` is `{ foo: number }`, the function body doesn't preserve the type beyond the structural transformation.

## Proposed Solutions

1. **Remove generic and type explicitly:** Change to `sanitizeCvJson(value: unknown): unknown` or use a specific CV type.
   - Pros: Honest types; simpler
   - Cons: Callers may need type assertions (but they already do)
   - Effort: Trivial
   - Risk: None

## Recommended Action

Remove generic, use explicit `unknown` types.

## Technical Details

- **Affected files:** `app/api/lib/json-docx-builder.ts`
- **No behavior change**
- **No API changes**
- **No test changes**

## Acceptance Criteria

- [ ] `sanitizeCvJson` no longer uses an unconstrained generic
- [ ] TypeScript strict mode passes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | Flagged by kieran-typescript-reviewer |
| 2026-07-20 | Implemented | Removed unconstrained generic from `sanitizeCvJson`; signature is now `(value: unknown): unknown` |

## Resources

- Source: `app/api/lib/json-docx-builder.ts`
