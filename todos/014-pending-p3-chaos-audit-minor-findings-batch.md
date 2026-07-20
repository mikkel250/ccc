---
status: completed
priority: p3
issue_id: "014"
tags: [code-review, cleanup, chaos-audit, batch]
dependencies: []
---

# Chaos audit — low-severity findings batch (Loop 1 & 2 leftovers)

## Problem Statement

The chaos audit (`feature/chaos-audit-2026-07-04`) shipped five high-impact fixes and filed two P2/P3 architectural todos (#012, #013). This ticket collects the remaining **low-severity** Loop 1 findings and Loop 2 refactoring targets that were flagged but not shipped — each too small to justify its own file, but worth tracking so they aren't lost.

Sub-items can be pulled into their own tickets during triage if any turn out to be worth their own PR. Otherwise this becomes a "spring cleaning" batch.

## Findings

### Bug-class (from Loop 1)

- **L1-08 · Dead defensive `try/catch` in `isValidDocxBase64`**
  - **File:** `app/api/lib/markdown-docx.ts:99-106`
  - **Issue:** `Buffer.from(str, "base64")` never throws in Node.js — it silently truncates on malformed input. The surrounding `try/catch` catches nothing and gives false confidence in validation.
  - **Fix:** Remove the `try/catch`, or replace it with a real validation (e.g. a strict base64 regex check before `Buffer.from`).

- **L1-09 · Redundant `stripProviderPrefix` in `callDeepSeek`**
  - **File:** `app/api/lib/llm.ts` — after chaos-audit fix #3, `callDeepSeek` still calls `stripProviderPrefix(model, 'deepseek')` even though `dispatchProvider` already strips the prefix before calling. The double-strip is idempotent (safe for non-prefixed strings) but is coupling smell.
  - **Fix:** Choose ONE stripping site. If `callDeepSeek` is called directly from tests (grep confirms it is: `tests/llm-deepseek.test.ts`), keep the strip inside `callDeepSeek` and remove it from `dispatchProvider` for the deepseek case. Or normalize dispatch to always feed already-stripped models and update tests to match.

- **L1-10 · `parseInlineMarkdown` produces empty `TextRun`s on pathological input**
  - **File:** `app/api/lib/markdown-docx.ts:15-29`
  - **Issue:** Input like `"****"` or a lone `"**"` produces empty TextRun runs. `docx` tolerates this so it's not a crash, but it's an unbounded-input DoS-adjacent smell if an LLM emits repeated `**` sequences.
  - **Fix:** After `part.slice(2, -2)`, skip if the resulting text is empty. Same for the else branch.

- **L1-11 · `getRatelimit()` singleton locks env at first call**
  - **File:** `app/api/lib/rate-limit.ts:14-20, 43-58`
  - **Issue:** `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_TIMEOUT_MS`, `RATE_LIMIT_REDIS_PREFIX` are read at module load. Any runtime env-var change is invisible until container recycle.
  - **Fix:** Read env vars *inside* `getRatelimit()` on first call, and add an optional TTL-based recreation, or explicitly document this as intentional in a code comment. Low urgency because runtime env-var mutation is not a real production scenario, but the current setup violates the spirit of "every literal is a future outage."

- **L1-13 · `RateLimitResult.resetTime?` type drift**
  - **File:** `app/api/lib/rate-limit.ts:22-27`
  - **Issue:** `resetTime` is typed as `number | undefined` but consumed as `number` in `route.ts:79-80, 108-110` and `scripts/verify-rate-limit.ts:52`. `@upstash/ratelimit` always populates it today, but this type discipline is loose.
  - **Fix:** Make `resetTime: number` non-optional in the result type, or add a caller-side default (`resetTime ?? 0`) at both consumer sites.

### Refactor-class (from Loop 2)

- **L2-04 · `input-filter.ts` — 378 lines, ~6 orthogonal policies in one file**
  - **File:** `lib/input-filter.ts`
  - **Issue:** Contains salary filter, location filter, work-authorization filter, role match, spam/keyboard-mash filter, and generic-query filter — six independent policies bolted into one file. Not on the tailor-cv hot path (`chat-prompt.ts` doc calls it "legacy").
  - **Fix:** Split into `lib/filters/{salary,location,role,auth,spam,generic}.ts` and re-export from `lib/input-filter.ts` for backward compatibility. Only do this if a `/api/chat` route is being planned; otherwise it's dead code and should be deleted, not reorganized.

- **L2-05 · Two KB loaders differ only in strictness**
  - **File:** `app/api/lib/knowledge-base.ts:34-61`
  - **Issue:** `loadKBFile` and `loadKBFileStrict` share ~90% of their bodies.
  - **Fix:** Combine into one `loadKBFile(fileName, { strict: boolean } = { strict: false })`. Only touch this if the legacy `getRelevantContext()` path is still needed; otherwise delete it alongside `loadKBFile` (see L2-04).

- **L2-06 · Route error-handling ladder should be a table**
  - **File:** `app/api/tailor-cv/route.ts:111-135`
  - **Issue:** Four `if` branches map error class → HTTP status → response body. This is data disguised as code.
  - **Fix:** Extract a `[predicate, status, mask]` table so the security-sensitive decision "which errors get their raw message forwarded to the client" is auditable in one place.

- **L2-07 · `testConnection()` mirrors `dispatchProvider` but as an if-chain**
  - **File:** `app/api/lib/llm.ts:588-628`
  - **Issue:** Uses `switch (provider)` on the same provider set as `dispatchProvider`, plus a fallback `if` chain for legacy envs. Two switches on the same enum in the same file.
  - **Fix:** Make it data-driven from the same provider registry `dispatchProvider` consults. Provider entries gain a `testConnection: () => Promise<boolean>` method.

- **L2-08 · Chat-prompt variants scattered at module root**
  - **Files:** `app/api/lib/chat-prompt.4o-mini.ts`, `chat-prompt.gemini-flash-v0.ts`, `chat-prompt.gemini-flash-v1.ts`
  - **Issue:** Model-versioned prompt variants live at the same level as production code.
  - **Fix:** Move to `app/api/lib/prompts/chat/{4o-mini,gemini-flash-v0,gemini-flash-v1}.ts`. Purely cosmetic; do as part of any larger prompt-management refactor.

## Proposed Solutions

Each sub-item is small enough to fix in isolation. Suggested cadence:

1. **Quick pass (30-60 min):** L1-08 (delete dead catch), L1-10 (skip empty TextRuns), L1-13 (make `resetTime` non-optional).
2. **Cleanup pass (1-2 h):** L1-09 (single strip site), L2-06 (error table), L2-08 (move prompt variants).
3. **Larger discussion needed:** L1-11 (env snapshot semantics — needs product decision), L2-04 (delete vs. split — needs `/api/chat` roadmap decision), L2-05 (couple with L2-04), L2-07 (couple with L2-01 provider-registry work).

## Recommended Action

**To be filled during triage.** Bundle Quick-pass items into a single "chore" PR; split the larger discussions out.

## Acceptance Criteria

Per sub-item, when picked up:

- [ ] Sub-item lifted into its own ticket OR resolved in place with acceptance criteria.
- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] No behavioral regression in the tailor-cv production path.

## Work Log

### 2026-07-04 — Batch created (Chaos Audit)

**By:** Cursor agent, `feature/chaos-audit-2026-07-04`

**Actions:**
- Enumerated Loop 1 findings and Loop 2 refactoring targets that were surfaced in the chaos-audit report but not shipped as part of that PR (which was focused on the top-5 impact fixes).
- Grouped into a single batch todo instead of ten individual P3 files to avoid queue spam.

**Learnings:**
- Not everything found during a chaos audit deserves its own PR. Correctness bugs and hot-path issues should ship immediately; code-quality items belong in a triage queue where they can be batched, or dropped if the affected code turns out to be dead.
- `input-filter.ts` and the legacy `getRelevantContext()` code path may not be worth refactoring at all — they exist for a hypothetical `/api/chat` route that hasn't been built. Decide "keep or delete" before "reorganize."

### 2026-07-05 — Resolved

**By:** Work execution agent, `feature/close-code-review-todos-batch`

**Disposition per sub-item:**

| ID | Fix |
|---|---|
| L1-08 | `isValidDocxBase64`: replaced the dead try/catch with a real base64-charset regex check (`Buffer.from` never throws — it silently truncates). |
| L1-09 | `dispatchProvider` no longer strips the deepseek prefix (only `callDeepSeek` does now) — single strip site, comment updated. |
| L1-10 | `parseInlineMarkdown`: skips pushing empty-text `TextRun`s for pathological `"**"`/`"****"` input; falls back to a plain non-empty run instead. |
| L1-13 | `RateLimitResult.resetTime` is now non-optional (`checkRateLimit` already always set it — type-only tightening, no runtime change). |
| L2-06 | `route.ts`'s four-branch error `if`-chain replaced with an `ERROR_RESPONSES` table (`[predicate, status, body]`, checked top to bottom) — the security-sensitive "which errors get their raw message forwarded" decision is now auditable as data. |
| L2-08 | Deleted `chat-prompt.4o-mini.ts`, `chat-prompt.gemini-flash-v0.ts`, `chat-prompt.gemini-flash-v1.ts` — confirmed via repo-wide grep to have zero importers. Deleted rather than moved to `prompts/chat/`, since moving dead code doesn't reduce the maintenance burden the finding was trying to address. |
| L2-04 | Deleted `lib/input-filter.ts` — zero importers, zero test coverage. No `/api/chat` route exists or is planned. |
| L2-05 | Deleted `knowledge-base.ts`'s `getRelevantContext()` and its six `isXxxQuery` classifiers, plus the unused `extractJobTitle()`. `loadKBFileStrict` renamed to `loadKBFile` now that the non-strict variant is gone — pure rename, `getAllContext()` is the sole caller either way. |
| L1-11 | **Deferred** — env-snapshot semantics for `getRatelimit()`'s singleton needs a product decision on whether runtime env-var mutation should ever recreate it. No current production need. |
| L2-07 | **Deferred** — the todo itself couples this to "L2-01 provider-registry work," which doesn't exist as a filed todo and would be materially larger than this batch's scope (moving a `Provider` set vs. giving providers behavior via per-entry `testConnection` methods). Recorded as an explicit deferral rather than folded in opportunistically. |

**Additional finding (out of scope, not actioned):** `app/api/lib/prompts.ts` (`buildChatSystemPrompt`, `isSkillQuery`, etc.) is also entirely unused — grep found zero callers. Not deleted in this batch since it wasn't in the original finding list; worth a follow-up todo if the legacy `/api/chat` path is formally abandoned.

`npm test` (313 tests, 309 pass / 4 pre-existing skips), `npm run lint`, and `npm run build` all pass across the full batch.
