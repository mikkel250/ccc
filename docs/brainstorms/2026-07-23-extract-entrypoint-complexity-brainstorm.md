---
date: 2026-07-23
topic: extract-entrypoint-complexity
source: Sourcery review feedback
---

# Extract Entrypoint Complexity

## What We're Building

Three independent refactorings pulling orchestration and configuration out of entrypoint files into testable library modules.

1. **Route handler:** Extract the POST pipeline from `route.ts` into `app/api/lib/tailor-pipeline.ts` exporting `runTailorPipeline(deps)`.
   - Input: `tailorCvDeps` bag, `NextRequest`
   - Output: `{ ok, data } | { ok: false, error, status }` — structured result (curated JSON, docx base64, usage, rate-limit info). Error→HTTP mapping stays at the route boundary.
   - Route becomes `POST(request) → runTailorPipeline(deps, request) → jsonResponse()`.

2. **Smoke CLI:** Extract core smoke logic from `scripts/e2e-tailor-cv.ts` into `app/api/lib/smoke-runner.ts` exporting `runSmoke(jd, baseUrl, options)`.
   - Wraps: health check, POST to `/api/tailor-cv`, artifact writing, dual-judge evaluation, gate check.
   - Returns scores and gate result. CLI remains primary consumer; library is importable by future API consumers.
   - `smoke-helpers.ts` (gate evaluation, redaction) stays independent — `runSmoke` imports it, doesn't absorb it.

3. **Schema path:** Replace the hard-coded relative path and `__resetCvSchemaValidatorForTest` in `cv-schema.ts` with `CV_SCHEMA_PATH` env var via `getEnvString`. Tests set `process.env.CV_SCHEMA_PATH` directly with `afterEach` cleanup — no test-only functions.

## Why This Approach

**Route handler — pipeline function, not service class.** A single `runTailorPipeline(deps, request)` composing the existing deps-bag functions introduces no new patterns. Error→HTTP mapping stays at the route boundary (existing `ERROR_RESPONSES` table).

**Smoke CLI — library extraction, CLI wraps it.** Extracting `runSmoke()` keeps the CLI a thin argument-parsing wrapper. `smoke-helpers.ts` remains independent; the runner imports it.

**Schema path — env var, no test reset.** `CV_SCHEMA_PATH` is optional via `getEnvString`. Absent → existing default path. Eliminates `__resetCvSchemaValidatorForTest` (test-only production code). Tests use `process.env.CV_SCHEMA_PATH` with `afterEach` cleanup — same pattern as existing size-limit tests.

## Key Decisions

- **Pipeline returns a result object, not HTTP.** The extracted `runTailorPipeline()` returns a structured result (curated JSON, docx base64, usage, rate-limit info, or a pipeline-stage error). The route maps that result to HTTP status codes — keeping the "handle errors at exactly one boundary" rule.
- **Smoke library is a single entry point, judges stay independent.** `runSmoke(jd, baseUrl, options)` returns scores and artifact paths. The dual-judge functions (`scoreJsonGrounding`, `scoreJsonJdFit`) stay in `eval-judge.ts` — `runSmoke` imports them, doesn't inline them.
- **Schema path follows `getEnvString` pattern.** `CV_SCHEMA_PATH` is optional; absent → use existing default path. No new config module needed — `cv-schema.ts` calls `getEnvString("CV_SCHEMA_PATH")` at validator-build time.
- **All three are independent.** Can be implemented and reviewed as separate commits in one PR, or as three separate PRs. No cross-dependency.

## Next Steps

→ `/workflows-plan` for implementation sequencing, file layout, and test strategy.
