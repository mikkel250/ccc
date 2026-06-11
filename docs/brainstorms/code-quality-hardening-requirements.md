# Code Quality Hardening — Requirements

**Source:** Migrated from dotdotgod plan `docs/plan/code-quality-hardening/README.md`
**Date:** 2026-06-07

## What the user wants to build

Harden the CV Tailoring API production path and offline eval pipeline against silent failures, incorrect HTTP semantics, and config-layer fragility identified in code review. Work is limited to `app/api/`, `lib/env.ts`, `scripts/eval-cv.ts`, `.env.example`, and corresponding tests under `tests/`. No frontend, no auth, no database, no architectural redesign.

## Acceptance Criteria (as requirements)

### Production path (`POST /api/tailor-cv`)
- Malformed JSON request body → 400 with structured error body (not 500)
- Missing/unreadable knowledge-base file → 503 with clear error (no silent partial tailoring)
- `x-forwarded-for` parsed to leftmost client IP (`split(",")[0].trim()`) with `"unknown"` fallback
- Rate-limit `resetTime` reflects oldest timestamp in bucket, not `now + window`

### Error discrimination
- Replace fragile `message.includes("Rate limit")` catch-block routing with typed error classes (`RateLimitError`, `ServiceError`)
- Route maps `instanceof` to HTTP status (429, 503, 500)

### Rate limiter
- Per-IP pruning replaces full-map scan on every request
- Per-IP promise-chain serialization mitigates concurrency race
- Existing tests continue to pass; new tests for concurrency and IP parsing

### Eval judge integrity
- `parseFailed: boolean` on all score types (`ExtractionScore`, `RelevanceScore`, `HallucinationScore`) and `JdExtraction`
- Consumers must check `parseFailed` before trusting scores
- Eval script surfaces parse failures in output metadata/warnings
- Duplicate raw JD removed from extraction judge prompt
- ~35 mock objects across test files updated with `parseFailed: false`

### Eval parse module extraction
- `extractStructuredJson` and `parseStringArray` moved to shared `eval-parse.ts`
- Breaks `eval-judge ← eval-extract` import cycle

### Config layer
- Circular import `lib/env.ts` ↔ `eval-schema.ts` broken via leaf `eval-defaults.ts`
- `getTailorModel()`, `getEvalJudgeModel()`, `getEvalExtractionModel()` validate namespaced `provider/model` format
- Judge prompt env vars cataloged in `.env.example`
- `JUDGE_MAP` built lazily; same-provider override pairs rejected with warning
- No dead config (`OPENROUTER_BASE_URL`) added

### Validation
- `npm test` passes, `npm run lint` passes, `npm run build` passes
- Tests assert behavior, not documentation content

## Constraints

- No architectural redesign — hardening only
- Rate-limit atomicity deferred to Redis (promise-chain is in-process MVP)
- Concurrency tests require mock clock or `setImmediate` yields
- KB fail-fast gated to required MVP files only (not all files)
- Eval result consumers may assume scores always present — check before changing schema

## Risks & Unknowns

- **Rate-limit atomicity (Medium):** Promise-chain serialization doesn't survive multi-instance deploys
- **Concurrency test reliability (Medium):** Node's single-threaded event loop makes burst overflow testing tricky
- **KB fail-fast (Medium):** May break local dev environments with intentionally partial KB
- **Judge failure signaling (Low):** Downstream eval consumers may assume scores are always present
- **Circular import split (Low):** Requires careful import order; run full test suite after refactor
- **ipChains memory leak (Moderate, post-review):** Resolved Promise entries never pruned from map; unbounded growth over weeks
- **requestLog stale keys (Low, post-review):** Same unbounded-growth class as ipChains; lower per-entry cost
