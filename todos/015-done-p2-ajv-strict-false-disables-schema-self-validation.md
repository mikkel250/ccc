---
status: done
priority: p2
issue_id: "015"
tags: [code-review, security, data-integrity, typescript]
dependencies: []
---

# Ajv `strict: false` disables schema self-validation and `unevaluatedProperties` checks

## Problem Statement

`app/api/lib/cv-schema.ts:42` creates the Ajv instance with `strict: false`:

```typescript
const ajv = new Ajv2020({ allErrors: true, strict: false });
```

This disables JSON Schema's own meta-validation of the schema document (structural correctness, keyword usage). While the schema is a checked-in trusted file, `strict: false` also disables runtime checks for `unevaluatedProperties`, `unevaluatedItems`, and other spec-compliance guards. This means:

1. If the schema is accidentally modified to include invalid keywords, it won't be caught at compile time
2. Curated JSON with unknown/additional properties beyond the schema's `additionalProperties: false` sections may pass validation silently
3. Draft-2020-12 features like `$dynamicRef`, `$defs` recursion, and `unevaluatedProperties` have reduced guardrails

## Findings

- **File:** `app/api/lib/cv-schema.ts:42` — `strict: false` on Ajv2020 constructor
- **Root cause:** Some draft-2020-12 schema features (like `$defs` and `$dynamicRef`) trigger strict-mode warnings in Ajv even when used correctly
- **Current mitigation:** Schema is checked into git as a static file; curated JSON size limits and schema validation provide defense-in-depth
- **Risk level:** Low-medium — the checked-in schema is the primary control, but `strict: false` weakens validation guarantees

## Proposed Solutions

### Option A: Enable strict mode and fix schema warnings
- **Effort:** Small
- **Risk:** Low
- **Pros:** Full Ajv spec compliance; catches schema errors at compile time
- **Cons:** May require schema adjustments if draft-2020-12 features trigger false warnings
- **Approach:** Set `strict: true` (default), run tests, identify any schema warnings, and adjust schema or configure specific strict-mode exceptions via `strictSchema` option

### Option B: Use `strictSchema: false` with `strict: true` for other checks
- **Effort:** Small
- **Risk:** Low
- **Pros:** Keeps most strict checks (type coercion, number formats, tuple shapes) while relaxing schema-level strictness
- **Cons:** Still loses schema self-validation
- **Approach:** `new Ajv2020({ allErrors: true, strict: true, strictSchema: false })`

### Option C: Keep as-is with comment documenting rationale
- **Effort:** Trivial
- **Risk:** None
- **Pros:** No code change; no risk of schema compatibility issues
- **Cons:** Silent acceptance of invalid schema modifications; reduced validation confidence
- **Approach:** Add comment above Ajv instantiation explaining why `strict: false` is needed

## Technical Details

- **Affected files:** `app/api/lib/cv-schema.ts`
- **Components:** Ajv schema validator
- **Database changes:** None

## Acceptance Criteria

- [x] Decision recorded: strict mode, strictSchema-only relaxation, or documented keep-as-is
- [x] If changed: all existing tests still pass
- [x] If changed: schema validation still accepts valid curated JSON fixtures

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-22 | Created from code review | architecture-strategist + security-sentinel |
| 2026-07-22 | Resolved — `strict: true` | Removed `strict: false`; all 368 tests pass. Schema uses draft-2020-12 features (`$defs`, `$dynamicRef`) but Ajv compiled without warnings. |

## Resources

- [Ajv strict mode docs](https://ajv.js.org/strict-mode.html)
- File: `app/api/lib/cv-schema.ts`
