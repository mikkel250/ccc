---
title: "test: Restore dedicated eval-parse unit tests"
date: 2026-09-06
type: test
topic: eval-parse-unit-tests
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
github_issue: 38
---

# test: Restore dedicated eval-parse unit tests

## Goal Capsule

- **Objective:** Put `extractStructuredJson` under a dedicated `tests/eval-parse.test.ts` suite so fence/trailing-text/empty/non-JSON regressions fail at the parser, not only through tailor or extract callers.
- **Authority:** This Product Contract. Source: GitHub #38 and `docs/residual-review-findings/feature-retire-llm-judges.md`.
- **Open blockers:** None.
- **Stop when:** The five cases named in #38 exist in `tests/eval-parse.test.ts`, production `eval-parse.ts` is unchanged, and `npm test` covers that file.

## Product Contract

### Summary

`tests/eval-judge.test.ts` used to cover `extractStructuredJson`. Judge teardown deleted that file and did not add `tests/eval-parse.test.ts`. The helper is still on the tailor hot path. Restore dedicated unit tests; do not change parse behavior.

### Problem Frame

Fence wrapping and trailing prose are the shapes LLMs actually emit. Indirect coverage through `extractJdMetadata` or the tailor pipeline can miss a parser-only regression until a live 422.

### Key Decisions

- **Restore the deleted `extractStructuredJson` cases as characterization tests; do not change `eval-parse.ts`.** `(session-settled: user-directed — chosen over rewriting the parser in this leftover: #38 is test restoration only)` Governs R1, R2, R3.
- **One test file: `tests/eval-parse.test.ts`.** `(session-settled: user-directed — chosen over putting cases back into a judge or extract suite: AGENTS one-file-per-module)` Governs R1.

### Requirements

- R1. `tests/eval-parse.test.ts` exists and imports `extractStructuredJson` from `app/api/lib/eval-parse.ts`.
- R2. The suite covers: plain JSON object; JSON inside markdown `json` fences (optional leading prose); JSON with trailing explanatory text; empty string throws; non-JSON text throws.
- R3. `app/api/lib/eval-parse.ts` is not modified in this work.
- R4. Residual leftover GitHub #38 remains the board join key until the drain PR lands; this plan is the executable artifact for that row.

### Scope Boundaries

- In: `tests/eval-parse.test.ts`; link this plan from the README leftover line; TDD red-seen-on-existing-code (temporarily break an assertion).
- Out: `parseStringArray` coverage; parser behavior changes; restoring `eval-judge`; smoke or tailor pipeline tests.

### Acceptance Examples

- AE1. `'{"score": 4}'` parses to the object `{ score: 4 }`. **Covers R2.**
- AE2. Prose plus a ` ```json ` fence containing an object parses to that object. **Covers R2.**
- AE3. A JSON object followed by trailing prose still parses the object. **Covers R2.**
- AE4. `""` and a non-JSON sentence throw an error matching `/empty|json|parse/i`. **Covers R2.**

### Success Criteria

- `node --test tests/eval-parse.test.ts` is green.
- Temporarily inverting one assertion fails for the right reason (characterization of existing code).

## Planning Contract

### Key Technical Decisions

- KTD1. **Characterize current `extractStructuredJson` with the five deleted cases; do not add new shapes (arrays, whitespace-only beyond `trim`, nested fences).** Instantiates R2, R3. `(session-settled: user-directed — chosen over expanding coverage in this leftover: #38 named those five)`
- KTD2. **Match existing node:test + `node:assert/strict` style in `tests/smoke-helpers.test.ts`.** Instantiates R1.

### Assumptions

- Current `eval-parse.ts` behavior is the intended contract (trim, optional fence, `{`…`}` slice, else `JSON.parse`).
- Whitespace-only input already throws via trim-to-empty; #38 did not require a separate case.

### Sequencing

U1 only.

### Implementation constraints

- Tests were deleted after the implementation; after they pass, temporarily break one assertion and confirm red, then restore.
- Do not import deleted judge modules.

## Implementation Units

### U1. Restore extractStructuredJson unit tests

- **Complexity:** Routine
- **Reason:** One new test file characterizing an unchanged helper; no production edits.

**Goal:** Dedicated failing-then-green tests for `extractStructuredJson`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** none

**Files:**
- `tests/eval-parse.test.ts`
- `docs/plans/README.md` (leftover line links this plan)

**Approach:** Add the five cases from the pre-teardown `tests/eval-judge.test.ts` `extractStructuredJson` describe block. Keep payloads in the same spirit (score/reasoning/flaggedClaims objects). Point the README leftover at this plan while keeping `GitHub #38` and `Lane: lfg` until drain marks `awaiting-merge`.

**Patterns to follow:** `tests/smoke-helpers.test.ts` (node:test, strict assert). Deleted source: `git show a397f17^:tests/eval-judge.test.ts` describe `extractStructuredJson`.

**Test scenarios:**
- Happy: plain object JSON → deep-equal parsed object.
- Edge: fenced JSON with leading prose → parsed object.
- Edge: object JSON plus trailing sentence → fields still readable.
- Error: empty string throws `/empty|json|parse/i`.
- Error: non-JSON prose throws `/json|parse/i`.

**Verification:** `node --test tests/eval-parse.test.ts`; then `npm test` for the suite.

**Execution note:** After green, invert one assertion, confirm red, restore.

## Verification Contract

| Command | Applies | Proves |
|---------|---------|--------|
| `node --test tests/eval-parse.test.ts` | U1 | Parser cases |
| Temporarily invert one assertion | U1 | Tests can fail |
| `npm test` | After U1 | No suite regression |
| `npm run lint` | After U1 | Clean |

## Definition of Done

- R1–R4 and AE1–AE4 hold.
- `eval-parse.ts` diff is empty.
- `npm test` and `npm run lint` pass.
- README leftover still names GitHub #38 until the drain `awaiting-merge` edit.
