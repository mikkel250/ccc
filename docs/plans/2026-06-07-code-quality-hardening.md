# Code Quality Hardening: API Production Path & Eval Pipeline Hardening

**Created:** 2026-06-07
**Source:** Migrated from dotdotgod plan `docs/plan/code-quality-hardening/README.md`
**Branch:** `feature/code-quality-hardening`

## Requirements

See [brainstorm](docs/brainstorms/code-quality-hardening-requirements.md) for full requirements. Summary:

- Production path: 400 on malformed JSON, 503 on KB failure, correct IP parsing, accurate rate-limit `resetTime`
- Typed error discrimination (`RateLimitError`, `ServiceError`) replacing string-based catch routing
- Rate limiter: per-IP pruning, promise-chain serialization
- Eval judge `parseFailed` signaling across all score types; duplicate raw JD removed from extraction prompt
- Eval parse module extraction breaking `eval-judge ← eval-extract` cycle
- Config layer: circular import broken, provider/model validation on all model getters, lazy `JUDGE_MAP`, `.env.example` catalog entries

## Constraints

- No architectural redesign — hardening only
- Rate-limit atomicity deferred to Redis (promise-chain is in-process MVP)
- KB fail-fast gated to required MVP files only
- From `docs/arch/README.md`: Environment variables only (no hardcoded keys), provider/model namespace for all LLM routing, test behavior not prose

## Implementation Units

### U1: Create typed error classes
- **Description:** Create `RateLimitError` and `ServiceError` classes extending `Error` in `app/api/lib/errors.ts`. Exported for use by `route.ts` and `knowledge-base.ts`.
- **Dependencies:** None
- **Validation:** `tests/errors.test.ts` — instanceof checks, message propagation
- **Status:** [x]
- **Note:** Complexity: Routine — new file with two simple Error subclasses

### U2: KB fail-fast in `getAllContext()`
- **Description:** Modify `app/api/lib/knowledge-base.ts` so `getAllContext()` throws `ServiceError` when any of five required KB files is missing/empty. Route catches `ServiceError` → 503. `getRelevantContext()` unchanged.
- **Dependencies:** None (uses `ServiceError` from U1 at integration)
- **Validation:** `tests/knowledge-base.test.ts` — mock `ENOENT` for each required file, assert throw with filename
- **Status:** [x]
- **Note:** Complexity: Routine

### U3: Route hardening — JSON parse, IP parsing, typed error discrimination
- **Description:** Modify `app/api/tailor-cv/route.ts`: (a) catch `request.json()` parse failures → 400; (b) parse `x-forwarded-for` as `split(",")[0].trim()` with `"unknown"` fallback; (c) replace `message.includes("Rate limit")` with `instanceof RateLimitError` → 429; (d) `instanceof ServiceError` → 503 before generic 500.
- **Dependencies:** U1 (`RateLimitError`, `ServiceError` types)
- **Validation:** `tests/route.test.ts` — 400 on malformed JSON, IP parsing with multiple headers, typed error → HTTP status mapping, 405 on GET
- **Status:** [x]
- **Note:** Complexity: Routine

### U4: Per-IP pruning in rate limiter
- **Description:** Replace full-map `pruneExpiredEntries()` scan with per-IP pruning — only filter current IP's timestamp array on access. Remove O(n) map iteration on every `checkRateLimit()` call.
- **Dependencies:** None
- **Validation:** `tests/rate-limit.test.ts` — assert IP-B expired entries NOT pruned by IP-A request; all existing tests pass
- **Status:** [x]
- **Note:** Complexity: Routine

### U5: Accurate `resetTime` in rate limiter
- **Description:** On allowed requests, `resetTime` reflects oldest timestamp in current IP's bucket (after adding current timestamp), not `Date.now() + BURST_WINDOW_MS`. Blocked requests already correct — keep.
- **Dependencies:** None
- **Validation:** `tests/rate-limit.test.ts` — first allowed: resetTime = only timestamp + window; mid-burst: oldest timestamp + window
- **Status:** [x]
- **Note:** Complexity: Routine

### U6: Per-IP promise-chain serialization in rate limiter
- **Description:** Wrap `checkRateLimit()` with per-IP `Promise` chain (`Map<string, Promise<void>>`). Chain onto existing promise for that IP before executing logic. Export becomes `async`.
- **Dependencies:** None (safest after U4-U5 to avoid merge conflicts)
- **Validation:** `tests/rate-limit.test.ts` — concurrent burst capped at maxRequests; per-IP isolation; existing tests updated for `await`
- **Status:** [x]
- **Note:** Complexity: Complex — concurrency test reliability in Node's event loop; mock clock recommended

### U7: Extract `eval-parse.ts` shared module
- **Description:** Create `app/api/lib/eval-parse.ts` with `extractStructuredJson()` and `parseStringArray()` moved from `eval-judge.ts`. Remove duplicate `parseStringArray()` from `eval-extract.ts`. Update imports to break `eval-judge ← eval-extract` cycle.
- **Dependencies:** None
- **Validation:** All existing tests pass without import changes (re-exports preserve paths); `npm test`
- **Status:** [x]
- **Note:** Complexity: Routine

### U8: Add `parseFailed` to eval schema types
- **Description:** Add `parseFailed: boolean` to `ExtractionScore`, `RelevanceScore`, `HallucinationScore`, and `JdExtraction` interfaces. Type-only addition — no logic changes.
- **Dependencies:** None
- **Validation:** `tests/eval-schema.test.ts` — type-satisfaction checks include `parseFailed: false`
- **Status:** [x]
- **Note:** Complexity: Routine — type-only but wide fixture blast radius (~35 mock objects across downstream tasks)

### U9: `eval-judge.ts` failure signaling
- **Description:** In `scoreExtraction()` catch, return `{ score: 0.5, parseFailed: true }` instead of silent neutral. Same for `scoreRelevance()` and `scoreHallucination()`. Successful paths add `parseFailed: false`. Import from `eval-parse.ts`.
- **Dependencies:** U7 (`eval-parse.ts` exists), U8 (`parseFailed` on types)
- **Validation:** `tests/eval-judge.test.ts` — ~15 mock objects updated; malformed JSON → `parseFailed: true`; successful → `parseFailed: false`
- **Status:** [x]
- **Note:** Complexity: Routine

### U10: `eval-extract.ts` failure signaling + extraction prompt dedupe
- **Description:** `extractJdMetadata()` catch returns `{ ...emptyExtraction, parseFailed: true }`. Successful path adds `parseFailed: false`. Remove duplicate raw JD from `scoreExtraction()` prompt in `eval-judge.ts`.
- **Dependencies:** U7 (`eval-parse.ts`), U8 (`parseFailed` on `JdExtraction`), U9 (prompt dedupe touches `eval-judge.ts`)
- **Validation:** `tests/eval-extract.test.ts` — ~8 mock objects updated; garbage LLM response → `parseFailed: true`; `tests/eval-judge.test.ts` — verify no `## Raw Job Description` block in scoreExtraction user message
- **Status:** [x]
- **Note:** Complexity: Routine

### U11: `eval-cv.ts` surfaces judge parse failures
- **Description:** After each score return, check `.parseFailed` — if true, push warning to `warnings` array. Scores still written to `scores.json` — surfaced, not blocked.
- **Dependencies:** U9, U10 (judge functions must emit `parseFailed` field)
- **Validation:** `tests/eval-cv.test.ts` — ~12 mock objects updated; parseFailed scores produce warnings in summary; verify scores still written
- **Status:** [x]
- **Note:** Complexity: Routine

### U12: Break circular import between `lib/env.ts` and `eval-schema.ts`
- **Description:** Create `app/api/lib/eval-defaults.ts` with four default constants. `eval-schema.ts` re-exports from it. `lib/env.ts` imports from `eval-defaults.ts` instead of `eval-schema.ts`. `eval-defaults.ts` must NOT import from `lib/env.ts` or `eval-schema.ts`.
- **Dependencies:** None
- **Validation:** `npm run build` succeeds; all existing tests pass without import changes
- **Status:** [x]
- **Note:** Complexity: Complex — wrong import split could re-create cycle or break build

### U13: Provider/model format validation on model getters
- **Description:** `getTailorModel()`, `getEvalJudgeModel()`, `getEvalExtractionModel()` call `validateDefaultModel()` before returning. Invalid format throws.
- **Dependencies:** U12 (defaults import path may change)
- **Validation:** `tests/env.test.ts` — valid namespaced model passes; unnamespaced throws; unknown provider throws; defaults pass validation
- **Status:** [x]
- **Note:** Complexity: Routine

### U14: Lazy `JUDGE_MAP` initialization with same-provider override rejection
- **Description:** Replace eager `JUDGE_MAP` with lazy `getJudgeMap()`. In `buildJudgeMap()`, reject same-provider generator/judge pairs with warning. Keep `JUDGE_MAP` export as deprecated alias.
- **Dependencies:** U12 (circular import resolved)
- **Validation:** `tests/eval-schema.test.ts` — valid override reflected; invalid JSON falls back; same-provider pair rejected with warning; `tests/env.test.ts` — env var change after load reflected via `getJudgeMap()`
- **Status:** [x]
- **Note:** Complexity: Routine

### U15: `.env.example` catalog entries for judge prompt env vars
- **Description:** Add commented entries for `RELEVANCE_JUDGE_PROMPT`, `HALLUCINATION_JUDGE_PROMPT`, `EXTRACTION_JUDGE_PROMPT`. Do NOT add `OPENROUTER_BASE_URL`.
- **Dependencies:** None
- **Validation:** None — documentation-only (no doc-content assertions per testing philosophy)
- **Status:** [x]
- **Note:** Complexity: Routine

## Open Questions

_No non-blocking items to carry forward._ `OPEN_QUESTIONS.md` sections are empty.

## Review Notes

See [REVIEW_NOTES.md](docs/plan/code-quality-hardening/REVIEW_NOTES.md) for legacy review findings:
- **ipChains Map Memory Leak** (Moderate, confirmed): Resolved Promise entries never pruned; unbounded growth
- **requestLog stale keys** (Low): Same unbounded-growth class as ipChains
