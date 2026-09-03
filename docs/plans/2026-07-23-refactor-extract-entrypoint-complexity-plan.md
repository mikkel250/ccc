---
title: "Extract Entrypoint Complexity — Route Pipeline, Smoke Library, Schema Config"
type: refactor
date: 2026-07-23
deepened: 2026-07-30
---

# Extract Entrypoint Complexity

## Overview

Three independent structural refactorings to pull orchestration and configuration out of entrypoint files into reusable, testable library modules. No behavior changes. All three follow existing conventions: discriminated unions, named exports, plain object DI bag, env-var-driven configuration.

**Status (2026-07-30):** U1 (schema path) and U2 (route pipeline) are complete and verified on `main`. U3 (smoke runner library) implemented on `feature/smoke-runner-extract`.

**Branch:** `feature/smoke-runner-extract` (U3).

## Problem Statement

Sourcery review of PR #15 identified three entrypoints where logic density makes the code harder to read, test, and modify:

1. **`app/api/tailor-cv/route.ts`** — **✅ COMPLETE.** Previously 332 lines, now 132 lines. The POST handler successfully extracted into `app/api/lib/tailor-pipeline.ts` (674 lines). Route is a thin HTTP wrapper: `POST(request) → buildTailorResponse(deps, request) → mapPipelineResult()`. Pipeline tests exist at `tests/tailor-pipeline.test.ts`.

2. **`scripts/e2e-tailor-cv.ts`** (325 lines) — the smoke CLI mixes health-check, JD resolution, HTTP calls, artifact writing (including cover-letter DOCX for flexible mode), dual-judge evaluation, and gate logic in a single script. The user envisions this evolving into a user-facing "paste JD, get CV" flow, which requires the core logic to be importable outside the CLI.

3. **`app/api/lib/cv-schema.ts`** — **✅ COMPLETE.** Now uses `CV_SCHEMA_PATH` env var via `getEnvString("CV_SCHEMA_PATH")` with existing default path as fallback. `__resetCvSchemaValidatorForTest()` removed. Tests use `process.env.CV_SCHEMA_PATH` with `afterEach` cleanup. `.env.example` updated.

## Proposed Solution

| # | From | To | What Moves |
|---|------|----|------------|
| 1 | `route.ts` POST handler | `app/api/lib/tailor-pipeline.ts` | 10-step orchestration into `buildTailorResponse(deps, request)` |
| 2 | `scripts/e2e-tailor-cv.ts` | `app/api/lib/smoke-runner.ts` | Core smoke logic into `verifySmokePipeline(masterCv, jd, options)` |
| 3 | `cv-schema.ts` hard-coded path | `cv-schema.ts` + env | `CV_SCHEMA_PATH` env var; remove `__resetCvSchemaValidatorForTest` |

### U2: Route Handler → Pipeline ✅ COMPLETE (landed on `main`)

- **Result:** `app/api/lib/tailor-pipeline.ts` (674 lines) exports `buildTailorResponse(deps, request)`. `route.ts` reduced to 132 lines — thin HTTP wrapper calling `mapPipelineResult()`. `tests/tailor-pipeline.test.ts` covers pipeline composition with mocked deps. `tests/route.test.ts` (580 lines, 39 tests) covers HTTP mapping.
- **Pipeline result type:** Returns discriminated union with HTTP status codes (plan decision, diverging from brainstorm's `{ stage }` proposal). The pipeline is single-consumer (exactly one route), so HTTP coupling in `lib/` is acceptable.
- **Utility placement:** `parseClientIp`, `isValidIp`, `readRequestBodyCapped`, `retryAfterSeconds` moved to `tailor-pipeline.ts`. `safeTailorLog` stays in `route.ts`. Pipeline uses `console.error` for LLM errors.
- **Verification:** Route tests pass (39/39). Pipeline tests pass (25/25). `npm test` baseline: 510 pass, 2 unrelated pre-existing failures (kebab-case + curation-mode), 4 skip.

### U3: Smoke CLI → Library ← REMAINING WORK

- **Description:** Extract core smoke logic from `scripts/e2e-tailor-cv.ts` (325 lines) into `verifySmokePipeline(masterCv, jd, options)` library function. Script becomes a thin CLI wrapper (~100 lines).
- **Complexity:** Complex
- **Reason:** Multi-file change (new library module + CLI rewrite + new test file); new `fetch` dependency in `app/api/lib/`; library needs `masterCv` data for judge calls; cover-letter DOCX handling must be included.

**Target:** `app/api/lib/smoke-runner.ts` exporting `verifySmokePipeline(masterCv, jd, options)`

Naming note: follows `verify`/`check`/`validate` family (`checkRateLimit`, `validateCvJson`). Describes the action: verifying the smoke pipeline end-to-end.

#### Logic to extract

1. **Health check** — `fetch GET /api/hello`; confirm `status === "ok"`
2. **POST to `/api/tailor-cv`** — with auth header, JD, sessionId, curationMode. Validate response shape (cv base64, curatedJson, builderVersion, coverLetter?)
3. **DOCX validation** — `isValidDocxBase64` on the returned cv (already in `markdown-docx.ts`)
4. **Dual-judge invocation** — `scoreJsonGrounding(masterCv, curatedJson, jd, judgeModel, { curationMode })` and `scoreJsonJdFit(masterCv, curatedJson, jd, judgeModel)` from `eval-judge.ts`
5. **Gate evaluation** — `evaluateSmokeJudgeGates(grounding, jdFit)` from `smoke-helpers.ts`

**Decision — artifact writing stays in script.** The current script writes curated JSON, DOCX, and cover-letter DOCX (flexible mode) to `tmp/smoke/`. This is file I/O tied to CLI invocation — not library concern. The library returns raw data; the script decides whether/when to write artifacts. The library signature returns the data needed:

#### Artifact writing (stays in script, NOT in library)

- Curated JSON: `writeFileSync(curatedPath, JSON.stringify(payload))` — redacted unless `SMOKE_WRITE_UNREDACTED=1`
- DOCX: `writeFileSync(docxPath, Buffer.from(cvBase64, "base64"))`
- Cover-letter DOCX (flexible only): `markdownToDocxBase64(coverLetter)` → validation → `writeFileSync`

These use `smokeArtifactPaths(jdPath, dir)` from `smoke-helpers.ts` (stays independent).

#### Library signature (updated)

```typescript
async function verifySmokePipeline(
  masterCv: unknown,
  jd: string,
  options: {
    baseUrl: string;
    curationMode: CurationMode;
    apiKey: string;
    judgeModel: string;     // from getEvalJudgeModel()
    groundingMin?: number;  // from getSmokeGroundingMin()
    jdFitMin?: number;      // from getSmokeJdFitMin()
  }
): Promise<VerifySmokeResult>

type VerifySmokeSuccess = {
  ok: true;
  // Tailor response
  curatedJson: unknown;
  docxBase64: string;
  builderVersion: string;
  coverLetter?: string;       // flexible mode only
  model: string;
  // Judge scores
  groundingScore: number;
  groundingParseFailed: boolean;
  groundingFlaggedCount: number;
  jdFitScore: number;
  jdFitParseFailed: boolean;
  jdFitReasoning: string;
  // Gate
  gatePassed: boolean;
  gateReasons: string[];
};

type VerifySmokeFailure = {
  ok: false;
  stage: "health" | "tailor" | "docx" | "judges";
  error: string;
  status?: number;
};

type VerifySmokeResult = VerifySmokeSuccess | VerifySmokeFailure;
```

**Key changes from earlier draft:** (a) `masterCv` is now a required first parameter (judges need it — the script calls `loadMasterCv()` in `main()`, not inside `postTailor()`). (b) Judge model and thresholds are passed in options rather than read from env inside the library (keeps library testable without env mutation). (c) `coverLetter` included in result for flexible mode. (d) `artifactDir` removed — artifact writing stays in script.

#### What stays in script

- `dotenv/config` import (env loading is a CLI concern)
- CLI argument parsing (`baseUrl`, `jdPath`, `--flexible`)
- `resolveCurationMode()` — reads `SMOKE_CURATION_MODE` + `--flexible` flag
- `loadJd()` / `defaultJdPath()` — file I/O
- `loadMasterCv()` — its result is passed to the library
- Artifact writing (all `writeFileSync` calls, redaction logic)
- `main()` entrypoint — sequences: load master → call library (which runs health check internally) → write artifacts → exit

#### What stays independent (unchanged)

- `smoke-helpers.ts` — gate evaluation (`evaluateSmokeJudgeGates`), redaction (`redactCuratedForArtifact`), threshold getters (`getSmokeGroundingMin`, `getSmokeJdFitMin`), artifact paths (`smokeArtifactPaths`), cover-letter gating (`shouldWriteCoverLetterDocx`)
- `eval-judge.ts` — `scoreJsonGrounding`, `scoreJsonJdFit`
- `eval-schema.ts` — unchanged
- `markdown-docx.ts` — `markdownToDocxBase64`, `isValidDocxBase64`

#### Library-or-script boundary decisions

| Concern | Library | Script | Reason |
|---------|---------|--------|--------|
| Health check | ✓ | — | Part of smoke verification; library returns failure if unhealthy |
| POST tailor | ✓ | — | Core verification step |
| Judge invocation | ✓ | — | Core verification step |
| Gate evaluation | ✓ | — | Core verification step; imports from `smoke-helpers.ts` |
| Artifact writing | — | ✓ | File I/O is CLI concern; library returns data, script writes |
| Cover-letter DOCX conversion | — | ✓ | Calls `markdownToDocxBase64` + `writeFileSync`; library returns raw `coverLetter` string |
| Master CV loading | — | ✓ | `loadMasterCv()` reads from env/path; result passed to library |
| Judge model resolution | — | ✓ | `getEvalJudgeModel()` reads env; result passed in options |
| Curation mode resolution | — | ✓ | Reads `SMOKE_CURATION_MODE` + `--flexible`; result passed in options |
| Env loading (`dotenv/config`) | — | ✓ | Must run before any env reads |

#### Test impact

New `tests/smoke-runner.test.ts` tests the library with:
- Mocked `globalThis.fetch` for health check and POST (avoids real network)
- Mocked `scoreJsonGrounding` and `scoreJsonJdFit` (avoids real LLM calls)
- Mocked `evaluateSmokeJudgeGates` if gate logic changes shape
- Passes master CV fixture, JD, and options directly (no env reads in library)

Existing `tests/smoke-helpers.test.ts` unaffected.

### U1: Schema Path → Env Var ✅ COMPLETE (landed on `main`)

- **Result:** `cv-schema.ts` reads schema path from `getEnvString("CV_SCHEMA_PATH")` with original relative path as default. `__resetCvSchemaValidatorForTest()` and `schemaPathOverride` removed. `.env.example` includes `CV_SCHEMA_PATH=` entry.
- **Implementation note:** Added `?.trim()` on the env var value for robustness (not in original spec — pragmatic addition). Tests cover: default path, custom path via env var, trimmed whitespace path, and nonexistent path error.
- **Verification:** 17/17 cv-schema tests pass. No other test imports `__resetCvSchemaValidatorForTest`.

## Technical Considerations

### What Does NOT Change (U3)

- `smoke-helpers.ts`, `eval-judge.ts`, `eval-schema.ts` — unchanged. Library imports, doesn't absorb.
- `markdown-docx.ts` — unchanged. Cover-letter DOCX conversion stays in script.
- `tailorCvDeps` bag — unchanged.
- All existing route and pipeline tests — unaffected.

### U3 Smoke Runner Test Strategy

The smoke runner is inherently integration-heavy (fetch, judges, gate evaluation). Test strategy:

- **Library unit tests:** Mock `globalThis.fetch` at the HTTP layer — return pre-baked success/error responses. Mock `scoreJsonGrounding` and `scoreJsonJdFit` to return controlled scores. Mock `evaluateSmokeJudgeGates` to test gate-pass and gate-fail paths independently. No real network or LLM calls.
- **What to test:** (a) health check failure → `VerifySmokeFailure` with `stage: "health"`, (b) tailor POST failure/error status → `VerifySmokeFailure` with `stage: "tailor"` and `status`, (c) invalid DOCX (valid HTTP 200, non-DOCX body) → `VerifySmokeFailure` with `stage: "docx"`, (d) judge parse failures (both `scoreJsonGrounding` and `scoreJsonJdFit` return `parseFailed: true`, never throw) → `VerifySmokeSuccess` with `gatePassed: false` and `gateReasons` populated by `evaluateSmokeJudgeGates`, (e) gate pass/pass-vs-fail → correct `gatePassed` and `gateReasons` values for pass, parse-fail, flagged-claims, and below-threshold scenarios, (f) flexible mode includes `coverLetter` in result, (g) strict mode omits `coverLetter`.
- **Script tests:** Script-owned concerns must be tested before extraction is declared complete. Add tests in `tests/e2e-tailor-cv.test.ts` covering: (a) artifact writing — success and disk-full/perm-denied failure paths for JSON, DOCX, and cover-letter DOCX, (b) redaction — `writeFileSync` with redacted vs unredacted payload depending on `SMOKE_WRITE_UNREDACTED`, (c) cover-letter DOCX conversion — `markdownToDocxBase64` integration with `writeFileSync`, (d) `resolveCurationMode` — returns strict when `SMOKE_CURATION_MODE=strict` and `--flexible` is absent, returns flexible when `SMOKE_CURATION_MODE=flexible` or `--flexible` is passed, and exits with error on unset/malformed mode, (e) exit codes — `process.exit(0)` on success, `process.exit(1)` on failure for each stage (health, tailor, docx, judges). Mock `globalThis.fetch` and `process.exit`; use temp directories for artifact assertions. Write these tests before implementing the extraction so they are observed failing, then make them pass as part of U3.

### Order

U3 is the only remaining unit. Single commit, single PR. No cross-dependencies with U1/U2 (already landed).

## Acceptance Criteria

### Refactoring 1: Pipeline ✅ VERIFIED (2026-07-30)

- [x] `app/api/lib/tailor-pipeline.ts` exists with `buildTailorResponse(deps, request)` export
- [x] POST handler in `route.ts` is 132 lines (thin HTTP → pipeline → HTTP mapper) — includes `POST`, `GET`, `ERROR_RESPONSES`, `mapErrorToResponse`, `safeTailorLog`, `jsonResponse`
- [x] Pipeline returns discriminated union; route maps to HTTP (pipeline returns HTTP status codes per plan decision)
- [x] Utility functions (`parseClientIp`, `readRequestBodyCapped`, `retryAfterSeconds`) moved to pipeline
- [x] `safeTailorLog` stays in route.ts
- [x] All existing route tests pass (39/39)
- [x] `tests/tailor-pipeline.test.ts` covers pipeline composition and error propagation (25 tests)
- [x] `npm test` — 510 pass, 2 pre-existing failures (unrelated), 4 skip

### Refactoring 2: Smoke Library

- [x] `app/api/lib/smoke-runner.ts` exists with `verifySmokePipeline(masterCv, jd, options)` export
- [x] `scripts/e2e-tailor-cv.ts` is a thin CLI wrapper: parse args, resolve JD + master CV, call `verifySmokePipeline`, write artifacts
- [x] `smoke-helpers.ts` unchanged (imported by library, not absorbed)
- [x] `eval-judge.ts` unchanged
- [x] Artifact writing (JSON, DOCX, cover-letter DOCX) stays in script, not library
- [x] New `tests/smoke-runner.test.ts` tests library with mocked fetch/judges via optional `deps`
- [x] Script tests in `tests/e2e-tailor-cv.test.ts` cover artifacts, redaction, curation mode, exit codes
- [x] `npm run build` passes (smoke script still compiles)
- [x] Manual smoke: `npm run smoke` against running dev server confirms end-to-end still works

### Refactoring 3: Schema Path ✅ VERIFIED (2026-07-30)

- [x] `CV_SCHEMA_PATH` env var supported via `getEnvString("CV_SCHEMA_PATH")`
- [x] `__resetCvSchemaValidatorForTest()` function removed
- [x] `schemaPathOverride` variable removed
- [x] Default path unchanged when env var is absent
- [x] `tests/cv-schema.test.ts` uses `process.env.CV_SCHEMA_PATH` + `afterEach` cleanup
- [x] All cv-schema tests pass (17/17)
- [x] `CV_SCHEMA_PATH` added to `.env.example` with comment

## System-Wide Impact

- **Route surface (U2 — landed):** `POST /api/tailor-cv` behavior unchanged. Pipeline returns HTTP status codes directly; route's `mapPipelineResult` maps to `NextResponse`. Internal call stack changed; external contract identical.
- **Module boundary (U2 — landed):** `tailor-pipeline.ts` imports from `tailor-cv-deps.ts` (no reverse dep). Pipeline uses `console.error` for LLM errors; `safeTailorLog` stays in route.ts for the `mapErrorToResponse` catch-all.
- **Schema loading (U1 — landed):** `CV_SCHEMA_PATH` optional — absent → identical default. No deploy config required.
- **Smoke CLI (U3 — remaining):** Script still runs via `npm run smoke`. New import: `verifySmokePipeline` from `app/api/lib/smoke-runner.ts`. No change to CLI invocation. `smoke-helpers.ts`, `eval-judge.ts` unchanged.
- **Smoke module boundary (U3):** `smoke-runner.ts` imports from `smoke-helpers.ts` and `eval-judge.ts` (no reverse deps). Does not import from `route.ts` or `tailor-pipeline.ts`. Library is importable by future API consumers (e.g., a `/verify` endpoint).
- **Test surface:** U1/U2 added `tests/tailor-pipeline.test.ts` (25 tests) with no net loss in route coverage. U3 will add `tests/smoke-runner.test.ts`. No existing test files affected by U3.

## Risks & Dependencies

### U3-specific risks

- **Risk:** Smoke runner library introduces new `fetch` dependency in `app/api/lib/` (currently script-only). **Mitigation:** `fetch` is available globally in Node.js 22. No new npm dependency. Mock with `globalThis.fetch` in tests.
- **Risk:** Cover-letter DOCX conversion (`markdownToDocxBase64`) is non-trivial and currently tightly coupled to artifact writing. **Mitigation:** Library returns raw `coverLetter` string; conversion stays in script. No new dependency for the library.
- **Risk:** Judge model resolution (`getEvalJudgeModel()`) reads env — if library calls it internally, tests must mutate env. **Mitigation:** Library accepts `judgeModel` in options; script reads env and passes it. Library stays env-agnostic.
- **Risk:** `npm test` baseline includes 2 pre-existing failures. **Mitigation:** U3 must not introduce new failures. Run `npm test` before starting to confirm baseline, and after to confirm only pre-existing failures remain.
- **Risk:** Smoke script has no existing automated tests — extraction could break the only verification path for the live pipeline. **Mitigation:** Run `npm run smoke` before and after extraction against a running dev server to confirm end-to-end parity. The library tests provide the safety net going forward.

### Dependencies

- **None.** U1 and U2 already landed on `main`. U3 has no cross-dependency with other in-flight work.
- The `smoke-helpers.ts` / `eval-judge.ts` APIs are stable and will not be modified by U3.

### Verification Strategy (U3 only)

1. **Pre-extraction baseline:** `npm test` → record exact pass/fail/skip counts. `npm run smoke` against dev server → confirm passes.
2. **Extraction gate:** `npm test` must match baseline. `npm run build` must pass.
3. **Post-extraction smoke:** `npm run smoke` against dev server must produce identical results (same scores, same gate outcome).

## References

- Brainstorm: `docs/brainstorms/2026-07-23-extract-entrypoint-complexity-brainstorm.md`
- Plan (PR #15): `docs/plans/2026-07-20-001-feat-json-curator-cv-pipeline-plan.md`
- Architecture: `docs/arch/README.md`
- Code conventions: `docs/arch/CODE_CONVENTIONS.md`
- Files: `app/api/tailor-cv/route.ts`, `app/api/lib/tailor-cv-deps.ts`, `app/api/lib/tailor-pipeline.ts`, `scripts/e2e-tailor-cv.ts`, `app/api/lib/cv-schema.ts`, `app/api/lib/smoke-helpers.ts`, `app/api/lib/eval-judge.ts`, `app/api/lib/markdown-docx.ts`
- Tests: `tests/route.test.ts`, `tests/tailor-pipeline.test.ts`, `tests/cv-schema.test.ts`, `tests/smoke-helpers.test.ts`
