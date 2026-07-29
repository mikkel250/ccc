---
title: "feat: Write flexible smoke cover letter as DOCX"
date: 2026-07-28
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# feat: Write flexible smoke cover letter as DOCX

## Goal Capsule

- **Objective:** When `npm run smoke` runs in flexible mode, also write the API `coverLetter` markdown to `tmp/smoke/<slug>.cover-letter.docx` using the existing markdown→docx helper. If the letter is missing/blank, warn and skip that write — do not fail judge gates or the CV/JSON artifacts.
- **Authority:** Product Contract below; API already returns `coverLetter` for flexible (`docs/api/API.md`).
- **Stop when:** Flexible smoke writes a valid cover-letter DOCX when present; missing letter only warns; strict smoke unchanged; unit tests + TESTING.md updated.

## Product Contract

### Summary

Flexible smoke currently ignores `coverLetter` even though the tailor API returns it. Close the artifact gap by converting that markdown to DOCX locally in the smoke script. Missing/empty letter is warn+skip (session-settled), not a hard smoke failure.

### Requirements

- R1. Flexible smoke writes `<slug>.cover-letter.docx` when `coverLetter` is a non-empty string.
- R2. Missing or empty `coverLetter` on flexible success logs a warning and skips the cover-letter DOCX write without failing judge gates or CV/JSON writes.
- R3. Strict smoke does not write a cover-letter DOCX.
- R4. Cover-letter DOCX is produced via existing `markdownToDocxBase64` (no new DOCX stack).
- R5. TESTING.md documents the new artifact path and warn+skip behavior.

### Scope Boundaries

- In: smoke helpers path naming, e2e smoke write path, unit tests for paths, TESTING.md.
- Out: API/pipeline changes; requiring cover letter for HTTP 200; markdown-only cover-letter artifact; extending `SMOKE_WRITE_UNREDACTED` to cover letters.
- Deferred to follow-up: hard-fail flexible smoke when cover letter absent (rejected for this plan).

### Acceptance Examples

- AE1. Flexible smoke with non-empty `coverLetter` → `tmp/smoke/<slug>.cover-letter.docx` exists and is a ZIP/DOCX (PK magic).
- AE2. Flexible smoke with missing/empty `coverLetter` → warning on stderr/stdout; smoke continues; no cover-letter DOCX (or no overwrite from this run); judge gates still decide pass/fail independently.
- AE3. Strict smoke → only `<slug>.docx` + `<slug>.curated.json` as today.

## Planning Contract

### Key Technical Decisions

- KTD1. Artifact name `${slug}.cover-letter.docx` via extended `smokeArtifactPaths` (session-settled: user-directed — chosen over fail-on-missing; warn+skip for empty letter).
- KTD2. Reuse `app/api/lib/markdown-docx.ts` (`markdownToDocxBase64`); smoke is a runtime consumer alongside existing unit tests — no new builder.
- KTD3. Cover-letter DOCX is unredacted, matching CV `.docx` posture. `SMOKE_WRITE_UNREDACTED` remains curated-JSON-only; document that in TESTING.md briefly.
- KTD4. Gate the write on `curationMode === "flexible"` and non-empty trimmed `coverLetter` string; do not treat absent field as a smoke gate failure.

### Assumptions

- Flexible API success may still omit `coverLetter` if the model skipped it; warn+skip is intentional until a later hard gate is desired.
- `tmp/` remains gitignored; artifacts are local-only.

## Implementation Units

### U1. Extend smoke artifact paths for cover-letter DOCX

- **Complexity:** Routine
- **Reason:** Single return-object addition in one well-isolated helper, following existing naming conventions with no new dependencies or contracts.

**Goal:** `smokeArtifactPaths` returns `coverLetterPath` beside existing paths.

**Requirements:** R1

**Dependencies:** none

**Files:**
- `app/api/lib/smoke-helpers.ts`
- `tests/smoke-helpers.test.ts`

**Approach:** Add `coverLetterPath: join(smokeDir, \`${slug}.cover-letter.docx\`)` to the return object. Keep existing `docxPath` / `curatedPath` unchanged.

**Patterns to follow:** Existing `smokeArtifactPaths` naming (`<slug>.curated.json` middle-token style).

**Test scenarios:**
- Happy path: JD basename `wayfare-mgr.md` → `coverLetterPath` ends with `wayfare-mgr.cover-letter.docx`.
- Edge: sanitized slug still produces a single `.cover-letter.docx` suffix (no double extension).

**Verification:** `tests/smoke-helpers.test.ts` green for path assertions.

### U2. Smoke script writes cover-letter DOCX (warn+skip)

- **Complexity:** Complex
- **Reason:** Multi-branch conditional logic threading `curationMode` + `coverLetter` through the smoke pipeline; touches public smoke interface with decision branches for flexible vs strict, present vs missing, and conversion failure handling.

**Goal:** After tailor PASS, flexible mode converts `coverLetter` markdown to DOCX and writes it; missing/empty warns and continues.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U1

**Files:**
- `scripts/e2e-tailor-cv.ts`

**Approach:**
- Extend `TailorSmokeResponse` with optional `coverLetter?: unknown`.
- Thread `coverLetter` + `curationMode` into `writeArtifacts` (or a small helper called from `main`).
- When flexible and `typeof coverLetter === "string"` with non-empty trim: `await markdownToDocxBase64(coverLetter)`, validate with `isValidDocxBase64`, write buffer to `coverLetterPath`.
- Include `coverLetterPath` in the existing overwrite warning when the file exists.
- When flexible and missing/empty: `console.warn(...)` and skip; do not `process.exit`.
- Strict: never write cover-letter DOCX.
- Docx build failure: warn + skip (same soft posture as missing letter) rather than aborting CV/JSON already written — unless implementer finds existing smoke treats CV docx failure as fatal (CV path already validated as ZIP before write); prefer soft warn for cover-letter-only conversion failures.

**Execution note:** Prefer a tiny pure helper (e.g. `shouldWriteCoverLetterDocx`) if it keeps `writeArtifacts` testable without live HTTP; otherwise keep logic in the script and rely on U1 + markdown-docx tests.

**Patterns to follow:** Existing `writeArtifacts` overwrite warn + `writeFileSync` for CV docx; `markdownToDocxBase64` from `tests/markdown-docx.test.ts` usage.

**Test scenarios:**
- Test expectation: none for full `e2e-tailor-cv.ts` main (live-only script) — cover with U1 path tests + existing `markdown-docx` suite; optional extracted pure predicate if introduced.
- If a pure helper is extracted: flexible + non-empty → write; flexible + empty → warn/skip; strict + letter present → skip write.

**Verification:** Unit suite green; manual flexible smoke produces `<slug>.cover-letter.docx` when the API returns a letter.

### U3. Document smoke cover-letter artifact

- **Complexity:** Routine
- **Reason:** Single-file documentation update with no runtime behavior, no contracts, and no test scenarios beyond content correctness.

**Goal:** TESTING.md lists the third artifact and warn+skip / unredacted posture.

**Requirements:** R5

**Dependencies:** U1, U2

**Files:**
- `docs/test/TESTING.md`

**Approach:** Update the smoke section artifact sentence (~line 129) to include `<jd-slug>.cover-letter.docx` for flexible runs and note warn+skip when absent; one line that cover-letter DOCX is unredacted like CV DOCX.

**Test expectation:** none — docs only.

**Verification:** TESTING.md matches implemented paths and behavior.

## Verification Contract

- `npm test` (includes `tests/smoke-helpers.test.ts`, `tests/markdown-docx.test.ts`)
- Manual: `npm run smoke -- http://localhost:3000 <jd> --flexible` with a successful tailor that returns `coverLetter` → file at `tmp/smoke/<slug>.cover-letter.docx`
- Confirm missing-letter path only via unit/predicate or by inspecting warn when reproducible

## Definition of Done

- U1–U3 complete
- Flexible smoke writes cover-letter DOCX when present; warns and continues when not
- Strict smoke unchanged
- No API contract changes
- TESTING.md updated
