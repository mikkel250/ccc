---
title: "feat: In-process strict tailor core"
date: 2026-09-06
type: feat
topic: in-process-tailor
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: docs/plans/2026-09-05-002-feat-inbox-worker-plan.md
execution: code
---

# feat: In-process strict tailor core

## Goal Capsule

- **Objective:** A labeled Gmail message can be strict-tailored in-process: claim + body extract + curator/DOCX, returning `cv` and `replyText` without HTTP auth or public rate-limit buckets.
- **Authority:** Inbox product contract R8 (and R1/R3 via the shared core; R7/R10 claim+extract already on this stack) in `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`. Board: M8.4.
- **Open blockers:** None.
- **Stop when:** `runTailorCore` is the shared curator+docx path; HTTP adapter still rate-limits; in-process labeled-message entry does not call `checkRateLimit` or Bearer; no Gmail drafts; processed mark still only after draft (M8.5).

## Product Contract

### Summary

Split `buildTailorResponse` into HTTP adapter vs `runTailorCore({ jobDescription, curationMode })`. Inbox calls the core after `extractUnprocessedInboxMessage`. Stacked on unmerged M8.1 (`replyText`) and M8.3 (extract/store) so the core matches R1.

### Key Decisions

- **Shared core, HTTP remains the rate-limit/Bearer adapter.** `(session-settled: user-directed — R8)` Rejected: worker POST to `/api/tailor-cv`.
- **Do not mark processed after tailor.** `(session-settled: user-directed — R10: terminal mark after draft)` Rejected: marking processed here.
- **Stack M8.1 + M8.3 rather than a core without `replyText`.** `(session-settled: user-approved — drain progress toward M8.4–M8.6 while those PRs await merge)` Rejected: waiting on `origin/main`.

### Requirements

- R8. In-process `{ jobDescription, curationMode: "strict" }` → R1 artifacts or R3-equivalent 422. No Bearer, no `RATE_LIMIT_*` buckets.
- R1/R3. Strict success includes `replyText`; blank reply is 422 without CV artifacts.
- R10. Claim before tailor; claim ≠ processed.

### Scope Boundaries

- In: extract `runTailorCore`; `tailorLabeledMessage`; tests; docs.
- Out: Gmail drafts/MIME (M8.5); `inbox:scan` CLI; Railway (M8.6); Gmail `messages.get` HTTP (caller supplies payload).

### Acceptance Examples

- AE1. `runTailorCore` strict success includes `cv`, `curatedJson`, `replyText`; `checkRateLimit` is not invoked. **Covers R8, R1.**
- AE2. Blank `reply_text` → 422, no `cv`. **Covers R3.**
- AE3. Processed id → skip, no chat. Lost claim → skip, no chat. **Covers R10.**

## Planning Contract

### Key Technical Decisions

- KTD1. **`runTailorCore` returns artifacts without `remaining`/`resetTime`; HTTP attaches those after rate-limit.** Instantiates R8.
- KTD2. **`tailorLabeledMessage(messageId, message)` = extract-unprocessed then strict core.** Instantiates “from a labeled message” without Gmail list (M8.2).
- KTD3. **This PR’s README does not copy other rows’ `awaiting-merge`.** Drain board hygiene.

## Implementation Units

### U1. Extract `runTailorCore`

- **Files:** `app/api/lib/tailor-pipeline.ts`, `tests/tailor-pipeline.test.ts`
- **Tests:** no `checkRateLimit`; strict `replyText`; HTTP path still rate-limits.

### U2. Labeled-message entry

- **Files:** `app/api/lib/inbox-tailor.ts`, `tests/inbox-tailor.test.ts`
- **Tests:** skip processed/claimed without chat; extracted JD goes to core.

### U3. Docs

- **Files:** `docs/plans/README.md`, `docs/arch/FILE_LAYOUT.md`, `docs/api/API.md`
- **Verification:** `tests/plans-readme.test.ts`.

## Definition of Done

- R8 holds. No drafts. No processed mark on tailor success.
