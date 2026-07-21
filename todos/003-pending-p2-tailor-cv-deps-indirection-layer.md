---
status: ready
priority: p2
issue_id: 003
tags: [code-review, architecture, simplicity]
dependencies: []
---

# `tailor-cv-deps.ts` Indirection Layer Adds Complexity Without Clear Benefit

## Problem Statement

`app/api/lib/tailor-cv-deps.ts` wraps every dependency (`authenticateTailorRequest`, `requireMasterCv`, `getCuratorPrompt`, `compileCuratorPrompt`, `buildCuratorUserMessage`, `validateCvJson`, `assertCuratedJsonSize`, `buildJsonDocxBase64`, `checkRateLimit`, `chat`, `extractStructuredJson`, `isLlmServiceError`) in a single exported object `tailorCvDeps`. The route handler only accesses these through `tailorCvDeps.*`. This creates an extra layer of indirection that:

1. Groups unrelated concerns (auth + prompt + LLM + docx) into a single bag
2. Makes it harder to trace where functions are actually defined
3. Does not enable test injection (tests mock at the module level via `mock.module()`)
4. Was flagged by 3 agents (code-simplicity-reviewer, architecture-strategist, pattern-recognition-specialist)

## Findings

- **Location:** `app/api/lib/tailor-cv-deps.ts`
- **Evidence:** The object is a plain re-export bag (`authenticateTailorRequest: authenticateTailorRequest`). No dynamic resolution, no test-swappable interface, no runtime polymorphism. Tests use `mock.module()` on the individual source modules, not on `tailorCvDeps`.
- **Pattern mismatch:** The rest of the codebase imports directly from source modules (`import { checkRateLimit } from "../lib/rate-limit"`). This is the only module that aggregates everything behind a namespace object.

## Proposed Solutions

1. **Remove `tailor-cv-deps.ts` and import directly:** Route handler imports from each source module directly. This matches the existing codebase pattern.
   - Pros: Removes unnecessary abstraction; matches existing conventions; easier to trace
   - Cons: Route handler imports grow from 1 to ~8 import lines
   - Effort: Small
   - Risk: Low

2. **Keep but add real value (test swapping):** Make `tailorCvDeps` a mutable object that `__injectForTest` functions can swap. This would justify the indirection.
   - Pros: Enables test injection without `mock.module()`
   - Cons: Adds more complexity; `mock.module()` already works fine
   - Effort: Medium
   - Risk: Medium

## Recommended Action

Solution 1 — remove and import directly.

## Technical Details

- **Affected files:** `app/api/lib/tailor-cv-deps.ts`, `app/api/tailor-cv/route.ts`, `tests/route.test.ts`
- **Affected components:** Route handler, test mocks
- **No database changes**
- **No API changes**

## Acceptance Criteria

- [ ] `tailor-cv-deps.ts` removed or its exports inlined into route.ts
- [ ] Route handler imports directly from source modules
- [ ] All 353 tests pass
- [ ] No new module-level coupling

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | Flagged by code-simplicity-reviewer, architecture-strategist, pattern-recognition-specialist |
| 2026-07-20 | Documented | Added explanation of why deps bag exists (ESM namespace mockability). Not removed — it is the test injection mechanism |

## Resources

- Source: `app/api/lib/tailor-cv-deps.ts`
- Pattern example: `tests/route.test.ts` — mocks via `mock.module()` on source modules
