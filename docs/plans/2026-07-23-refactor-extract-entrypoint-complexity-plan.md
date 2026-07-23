---
title: "Extract Entrypoint Complexity — Route Pipeline, Smoke Library, Schema Config"
type: refactor
date: 2026-07-23
deepened: 2026-07-23
---

# Extract Entrypoint Complexity

## Overview

Three independent structural refactorings to pull orchestration and configuration out of entrypoint files into reusable, testable library modules. No behavior changes. All three follow existing conventions: discriminated unions, named exports, plain object DI bag, env-var-driven configuration.

**Branch:** New branch off `main`, lands after PR #15 merges.

## Problem Statement

Sourcery review of PR #15 identified three entrypoints where logic density makes the code harder to read, test, and modify:

1. **`app/api/tailor-cv/route.ts`** (332 lines) — the POST handler inlines 8 pipeline steps (auth → IP → rate-limit → body-size → validate → curator → schema → docx). Reading the handler requires understanding all orchestration at once. Individual steps are already extracted in `tailorCvDeps`, but their composition and error routing is not.

2. **`scripts/e2e-tailor-cv.ts`** (~270 lines) — the smoke CLI mixes JD resolution, HTTP calls, artifact writing, dual-judge evaluation, and gate logic in a single script. The user envisions this evolving into a user-facing "paste JD, get CV" flow, which requires the core logic to be importable outside the CLI.

3. **`app/api/lib/cv-schema.ts`** — schema path is a hard-coded relative string with a test-only `__resetCvSchemaValidatorForTest()` function for swapping it. The existing convention is `getEnvString()` for any tunable path/config.

## Proposed Solution

| # | From | To | What Moves |
|---|------|----|------------|
| 1 | `route.ts` POST handler | `app/api/lib/tailor-pipeline.ts` | 8-step orchestration into `buildTailorResponse(deps, request)` |
| 2 | `scripts/e2e-tailor-cv.ts` | `app/api/lib/smoke-runner.ts` | Core smoke logic into `verifySmokePipeline(jd, baseUrl, options)` |
| 3 | `cv-schema.ts` hard-coded path | `cv-schema.ts` + env | `CV_SCHEMA_PATH` env var; remove `__resetCvSchemaValidatorForTest` |

### Refactoring 1: Route Handler → Pipeline

**Target:** `app/api/lib/tailor-pipeline.ts` exporting `buildTailorResponse(deps, request)`

Naming note: follows the dominant `build*` family (`buildJsonDocxBase64`, `buildCuratorUserMessage` — 10+ functions). Describes what the pipeline produces: a structured tailor response from all 8 pipeline steps.

**Architecture note — `NextRequest` dependency:** `parseClientIp` and `readRequestBodyCapped` accept `NextRequest`. Moving them to `tailor-pipeline.ts` keeps the framework type in `lib/`. Alternative: the route pre-parses `ip` and `bodyText` and passes plain strings to the pipeline. Tradeoff: pre-parsing in route adds ~10 lines but keeps `lib/` framework-agnostic. **Decision:** move them to pipeline as-is — `lib/` already imports Next.js types (`NextRequest`, `NextResponse` via `tailor-cv-deps.ts` → `route.ts` imports). Framework-agnosticism is not a current architectural goal.

**Architecture note — `status` in pipeline result:** The pipeline returns `{ ok: false, error, status }` where status is an HTTP code. Alternative: return error codes ("UNAUTHORIZED", "RATE_LIMITED") and have route map them. **Decision:** keep HTTP status codes in the pipeline result — the `ERROR_RESPONSES` table already maps status codes, and adding an intermediate error-code layer adds an unnecessary second mapping. The pipeline is not a general-purpose module — it serves exactly one route.

**Architecture note — `safeTailorLog`:** Used by pipeline (LLM errors) and route (catch-all). **Decision:** pipeline calls `console.error` directly for LLM errors; route's `mapErrorToResponse` catch-all remains the only `safeTailorLog` call site. `safeTailorLog` stays in route.ts.

The pipeline function composes the 8 steps already available in `tailorCvDeps`, returning a structured result:

```typescript
type TailorPipelineResult =
  | { ok: true; body: TailorResponseBody }
  | { ok: false; error: string; status: 400 | 401 | 413 | 422 | 429 | 503 };
```

Steps (same order as current handler):
1. `deps.authenticateTailorRequest(authorization)` → auth gate
2. `parseClientIp(request)` → IP resolution (stays inline or moves to a helper)
3. `deps.checkRateLimit(...)` → dual rate-limit
4. `readRequestBodyCapped(request, maxBytes)` → body cap
5. `JSON.parse(body)` + `validateTailorCvBody(body)` → validation
6. `deps.requireMasterCv()` + `deps.getCuratorPrompt()` + `deps.applyCurationModePolicy(...)` → prompt
7. `deps.compileCuratorPrompt(...)` + `deps.buildCuratorUserMessage(...)` → user message
8. `deps.chat(...)` → LLM call
9. `deps.extractStructuredJson(...)` + `deps.validateCvJson(...)` + `deps.assertCuratedJsonSize(...)` → schema gate
10. `deps.sanitizeForResponse(...)` + `deps.buildJsonDocxBase64(...)` → docx

**What stays in route.ts:**
- `runtime = "nodejs"` export
- `POST(request)` — thin wrapper: `await buildTailorResponse(deps, request)` → maps result to `jsonResponse()`
- `GET()` — 405 handler
- `mapErrorToResponse()` and `ERROR_RESPONSES` table
- `jsonResponse()`, `safeTailorLog()`, `isValidIp()`, `parseClientIp()`, `readRequestBodyCapped()`, `retryAfterSeconds()` — move to pipeline or a shared helper if used only by the pipeline

**Resolved: utility function placement** — `parseClientIp`, `isValidIp`, `readRequestBodyCapped`, `retryAfterSeconds` move to `tailor-pipeline.ts` (used only by pipeline). `safeTailorLog` stays in `route.ts` (shared by pipeline for LLM errors and `mapErrorToResponse` for catch-all). No separate `tailor-helpers.ts` — avoids premature abstraction for 4 single-consumer functions.

**Test impact:** `tests/route.test.ts` currently mocks `tailorCvDeps` methods with `mock.method()`. After extraction, route tests should verify the route maps pipeline results to HTTP — not test the pipeline itself. Pipeline gets its own `tests/tailor-pipeline.test.ts` with integration-style tests composing mocked deps.

### Refactoring 2: Smoke CLI → Library

**Target:** `app/api/lib/smoke-runner.ts` exporting `verifySmokePipeline(jd, baseUrl, options)`

Naming note: follows `verify`/`check`/`validate` family (`checkRateLimit`, `validateCvJson`). Describes the action: verifying the smoke pipeline end-to-end.

Logic to extract:
1. Health check (`GET /api/hello`)
2. POST to `/api/tailor-cv` with auth header and JD
3. Artifact writing (curated JSON, docx) — gated by `SMOKE_WRITE_UNREDACTED`
4. Dual-judge invocation (`scoreJsonGrounding`, `scoreJsonJdFit`) from `eval-judge.ts`
5. Gate evaluation (`evaluateSmokeJudgeGates`) from `smoke-helpers.ts`

**What stays in script:**
- `dotenv/config` import
- CLI argument parsing (baseUrl, jdPath, --flexible)
- JD resolution from file (or in-memory in the future)
- `resolveCurationMode()` — moves to library since it reads env
- `loadJd()` / `defaultJdPath()` — stays in script (file I/O is CLI concern)
- `main()` entrypoint

**Library signature:**
```typescript
async function verifySmokePipeline(
  jd: string,
  options: {
    baseUrl: string;
    curationMode: CurationMode;
    apiKey: string;
    writeUnredacted?: boolean;
  }
): Promise<{
  curatedJson: unknown;
  docxBase64: string;
  builderVersion: string;
  groundingScore: number;
  jdFitScore: number;
  gatePassed: boolean;
  artifactDir?: string;
}>
```

**What stays independent:** `smoke-helpers.ts` (gate evaluation, redaction, threshold getters) and `eval-judge.ts` (judge functions). `verifySmokePipeline` imports them, doesn't absorb them.

**Test impact:** New `tests/smoke-runner.test.ts` tests the library with mocked `fetch` and mocked judges. Existing smoke tests (if any) are in `tests/smoke-helpers.test.ts` — unaffected.

### Refactoring 3: Schema Path → Env Var

**Target:** `app/api/lib/cv-schema.ts`

Changes:
1. Add `CV_SCHEMA_PATH` env var read via `getEnvString("CV_SCHEMA_PATH")`
2. Default: existing `join(process.cwd(), "references", "json-curator", "master-cv.schema.json")`
3. Remove `__resetCvSchemaValidatorForTest()` function and `schemaPathOverride` variable
4. Tests use `process.env.CV_SCHEMA_PATH = fixturePath` with `afterEach(() => delete process.env.CV_SCHEMA_PATH)`

**Before:**
```typescript
let schemaPathOverride: string | null = null;

export function __resetCvSchemaValidatorForTest(pathOverride?: string | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error(...);
  schemaPathOverride = pathOverride === undefined ? null : pathOverride;
  validateFn = null;
}

function loadValidator(): ValidateFunction {
  if (validateFn) return validateFn;
  const schemaPath = schemaPathOverride ?? join(process.cwd(), SCHEMA_RELATIVE);
  // ...
}
```

**After:**
```typescript
function loadValidator(): ValidateFunction {
  if (validateFn) return validateFn;
  const schemaPath = getEnvString("CV_SCHEMA_PATH")
    ?? join(process.cwd(), SCHEMA_RELATIVE);
  // ...
}
```

**Test impact:** `tests/cv-schema.test.ts` — replace `__resetCvSchemaValidatorForTest("/nonexistent/...")` with `process.env.CV_SCHEMA_PATH = "/nonexistent/..."`. Add `afterEach` cleanup. Remove `__resetCvSchemaValidatorForTest` import.

## Technical Considerations

### Pipeline Test Strategy

The existing `tests/route.test.ts` (525 lines) has three categories of tests:
- **23 HTTP-only tests:** status codes, headers, error message format — stay in `tests/route.test.ts`
- **0 pipeline-only tests:** currently none test composition in isolation
- **6 mixed tests:** assert HTTP status AND verify step ordering via `mock.callCount()` — need careful handling; split into route-level (status) + pipeline-level (call ordering)

The pipeline test will use the same DI bag mocking pattern: `mock.method(tailorCvDeps, ...)`. This is the established pattern and requires no test infrastructure changes.

### What Does NOT Change

- `tailorCvDeps` bag — no new properties, no removal. Pipeline imports it, doesn't replace it.
- `ERROR_RESPONSES` table in route.ts — stays exactly as-is.
- All 14 deps functions — same signatures, same behavior.
- `smoke-helpers.ts`, `eval-judge.ts`, `eval-schema.ts` — unchanged.
- `cv-schema.ts` exports other than `__resetCvSchemaValidatorForTest` — same signatures.

### Order Independence

The three refactorings touch different files with no cross-dependencies. Can be implemented in any order. Recommend sequential commits in one PR for reviewability:

1. Commit 1: Schema path env var (smallest, least risk)
2. Commit 2: Route handler → pipeline (largest, most test impact)
3. Commit 3: Smoke CLI → library (medium)

## Acceptance Criteria

### Refactoring 1: Pipeline

- [ ] `app/api/lib/tailor-pipeline.ts` exists with `buildTailorResponse(deps, request)` export
- [ ] POST handler in `route.ts` is ≤40 lines (thin HTTP → pipeline → HTTP mapper)
- [ ] Pipeline returns discriminated union; route maps to HTTP (no HTTP in pipeline)
- [ ] Utility functions (`parseClientIp`, `readRequestBodyCapped`, `retryAfterSeconds`) moved to pipeline or shared helper
- [ ] `safeTailorLog` stays in route.ts (used by `mapErrorToResponse`)
- [ ] All existing route tests still pass
- [ ] New `tests/tailor-pipeline.test.ts` covers pipeline composition and error propagation
- [ ] `npm test` — same pass count (368), same skip count (4), no new failures

### Refactoring 2: Smoke Library

- [ ] `app/api/lib/smoke-runner.ts` exists with `verifySmokePipeline(jd, options)` export
- [ ] `scripts/e2e-tailor-cv.ts` is a thin CLI wrapper (~80 lines): parse args, resolve JD file, call `verifySmokePipeline`
- [ ] `smoke-helpers.ts` unchanged (imported by `verifySmokePipeline`, not absorbed)
- [ ] `eval-judge.ts` unchanged
- [ ] New `tests/smoke-runner.test.ts` tests library with mocked fetch and mocked judges
- [ ] `npm run build` passes (smoke script still compiles)

### Refactoring 3: Schema Path

- [ ] `CV_SCHEMA_PATH` env var supported via `getEnvString("CV_SCHEMA_PATH")`
- [ ] `__resetCvSchemaValidatorForTest()` function removed
- [ ] `schemaPathOverride` variable removed
- [ ] Default path unchanged when env var is absent
- [ ] `tests/cv-schema.test.ts` uses `process.env.CV_SCHEMA_PATH` + `afterEach` cleanup
- [ ] All cv-schema tests pass
- [ ] `CV_SCHEMA_PATH` added to `.env.example` with comment

## System-Wide Impact

- **Route surface:** `POST /api/tailor-cv` behavior is unchanged. Response shape (status codes, JSON body fields, headers) is identical. Only the internal call stack changes.
- **Module boundary:** New `tailor-pipeline.ts` imports from `tailor-cv-deps.ts` (no reverse dependency). Pipeline does not import from `route.ts` — `safeTailorLog` calls are passed as a callback if needed, or pipeline calls `console.error` directly for LLM errors and lets route's catch-all log via `safeTailorLog`.
- **Smoke CLI:** Script still runs via `npm run smoke`. Import path changes from inline logic to `verifySmokePipeline` from `app/api/lib/smoke-runner.ts`. No change to CLI invocation.
- **Schema loading:** `CV_SCHEMA_PATH` is optional — absent → identical behavior. No deploy config change required. `.env.example` updated.
- **Test surface:** No net change in test count. Route tests split between `tests/route.test.ts` (HTTP mapping) and `tests/tailor-pipeline.test.ts` (pipeline composition). New `tests/smoke-runner.test.ts` added.

## Risks & Dependencies

- **Risk:** `tests/route.test.ts` refactoring could accidentally drop coverage. **Mitigation:** Split tests before moving pipeline logic — categorize each test as route-level or pipeline-level, extract pipeline tests into new file while keeping route tests green, then extract the pipeline function.
- **Risk:** Pipeline function signature evolves differently than the current inline code. **Mitigation:** Extract mechanically first (exact copy of current logic), refactor after tests pass. The pipeline should be a pure extraction pass with zero logic changes in commit 2.
- **Risk:** Smoke runner library introduces new `fetch` dependency in `app/api/lib/` (currently script-only). **Mitigation:** `fetch` is available globally in Node.js 22. No new npm dependency. Mock with `globalThis.fetch` in tests.
- **Risk:** Removing `__resetCvSchemaValidatorForTest` breaks if any other test imports it. **Verification:** grep for `__resetCvSchemaValidatorForTest` across tests/ before removal. Currently only `tests/cv-schema.test.ts` imports it.
- **Dependency:** PR #15 must merge first — this branch is off `main`, not off the feature branch. The refactored code doesn't exist on `main` yet.

### Verification Strategy

1. **Pre-refactoring baseline:** `npm test` → 368 pass, 2 skip (eval-results). Record exact pass count.
2. **Per-commit gate:** After each of the 3 commits, `npm test` must match baseline. Any regression → fix before next commit.
3. **Lint gate:** `npm run lint` after each commit.
4. **Build gate:** `npm run build` after commit 2 (smoke script must still compile).
5. **Manual smoke:** After all 3 commits, `npm run smoke` against a running dev server to confirm end-to-end pipeline and smoke CLI still work.

## References

- Brainstorm: `docs/brainstorms/2026-07-23-extract-entrypoint-complexity-brainstorm.md`
- Plan (PR #15): `docs/plans/2026-07-20-001-feat-json-curator-cv-pipeline-plan.md`
- Architecture: `docs/arch/README.md`
- Code conventions: `docs/arch/CODE_CONVENTIONS.md`
- Files: `app/api/tailor-cv/route.ts`, `app/api/lib/tailor-cv-deps.ts`, `scripts/e2e-tailor-cv.ts`, `app/api/lib/cv-schema.ts`
- Tests: `tests/route.test.ts`, `tests/cv-schema.test.ts`
