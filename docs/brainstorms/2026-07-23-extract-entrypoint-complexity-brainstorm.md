---
date: 2026-07-23
topic: extract-entrypoint-complexity
source: Sourcery review feedback
---

# Extract Entrypoint Complexity

## What We're Building

Three independent refactorings pulling orchestration and configuration out of entrypoint files into testable library modules.

1. **Route handler:** Extract the POST pipeline from `route.ts` into `app/api/lib/tailor-pipeline.ts` exporting `buildTailorResponse(deps)`.
   - Input: `tailorCvDeps` bag, `NextRequest`
   - Output: `{ ok: true; body } | { ok: false; error: string; stage: PipelineStage }` — HTTP-agnostic (no `status`). Route maps `stage` → HTTP exclusively at the `jsonResponse` / `ERROR_RESPONSES` boundary.
   - Route becomes `POST(request) → buildTailorResponse(deps, request) → jsonResponse()`.

2. **Smoke CLI:** Extract core smoke logic from `scripts/e2e-tailor-cv.ts` into `app/api/lib/smoke-runner.ts` exporting `verifySmokePipeline(jd, baseUrl, options)`.
   - Wraps: health check, POST to `/api/tailor-cv`, artifact writing, dual-judge evaluation, gate check.
   - Returns scores and gate result. CLI remains primary consumer; library is importable by future API consumers.
   - `smoke-helpers.ts` (gate evaluation, redaction) stays independent — `verifySmokePipeline` imports it, doesn't absorb it.

3. **Schema path:** Replace the hard-coded relative path and `__resetCvSchemaValidatorForTest` in `cv-schema.ts` with `CV_SCHEMA_PATH` env var via `getEnvString`. Tests set `process.env.CV_SCHEMA_PATH` directly with `afterEach` cleanup — no test-only functions.

## Why This Approach

**Route handler — pipeline function, not service class.** A single `buildTailorResponse(deps, request)` composing the existing deps-bag functions introduces no new patterns. Error→HTTP mapping stays at the route boundary (existing `ERROR_RESPONSES` table).

**Smoke CLI — library extraction, CLI wraps it.** Extracting `verifySmokePipeline()` keeps the CLI a thin argument-parsing wrapper. `smoke-helpers.ts` remains independent; the runner imports it.

**Schema path — env var, no test reset.** `CV_SCHEMA_PATH` is optional via `getEnvString`. Absent → existing default path. Eliminates `__resetCvSchemaValidatorForTest` (test-only production code). Tests use `process.env.CV_SCHEMA_PATH` with `afterEach` cleanup — same pattern as existing size-limit tests.

## Key Decisions

- **Pipeline returns a result object, not HTTP.** The extracted `buildTailorResponse()` returns success data (curated JSON, docx base64, usage, rate-limit info) or `{ ok: false; error; stage }` with no HTTP `status`. The route alone chooses status codes at `jsonResponse` — "handle errors at exactly one boundary."
- **Smoke library is a single entry point, judges stay independent.** `verifySmokePipeline(jd, baseUrl, options)` returns scores and artifact paths. The dual-judge functions (`scoreJsonGrounding`, `scoreJsonJdFit`) stay in `eval-judge.ts` — `verifySmokePipeline` imports them, doesn't inline them.
- **Schema path follows `getEnvString` pattern.** `CV_SCHEMA_PATH` is optional; absent → use existing default path. No new config module needed — `cv-schema.ts` calls `getEnvString("CV_SCHEMA_PATH")` at validator-build time.
- **All three are independent.** Can be implemented and reviewed as separate commits in one PR, or as three separate PRs. No cross-dependency.

## Next Steps

→ `/workflows-plan` for implementation sequencing, file layout, and test strategy.
