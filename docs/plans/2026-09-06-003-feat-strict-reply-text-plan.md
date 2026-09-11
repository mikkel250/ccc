---
title: "feat: Strict tailor reply text"
date: 2026-09-06
type: feat
topic: strict-reply-text
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: docs/plans/2026-09-05-002-feat-inbox-worker-plan.md
execution: code
---

# feat: Strict tailor reply text

## Goal Capsule

- **Objective:** Successful `strict` `POST /api/tailor-cv` returns sendable recruiter reply email text (`replyText`) from the same curator pass as the Curated CV, and strict smoke writes that text next to the CV artifacts.
- **Authority:** Inbox product contract R1–R5 in `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`. Board: M8.1 in `docs/plans/README.md`.
- **Open blockers:** None.
- **Stop when:** Strict HTTP returns trimmed non-empty `replyText` or 422; flexible is unchanged; smoke writes `<slug>.reply.txt` in strict; no Gmail, no in-process worker extract (M8.4).

## Product Contract

### Summary

Strict curator output becomes a wrapper `{ curated_cv, reply_text }` (same pattern as flexible `{ curated_cv, cover_letter }`). HTTP/in-process field is `replyText`. Missing/blank reply is 422 with no CV artifacts. Flexible does not grow `replyText`.

### Problem Frame

Smoke can produce a CV, but the operator has no sendable recruiter reply on the strict path. Inbox drafts (M8.5) need that string from the shared tailor core.

### Key Decisions

- **Reuse the inbox contract; do not reopen wrapper vs field names.** `(session-settled: user-directed — chosen in the inbox product contract: curator key reply_text, HTTP replyText, wrapper + trim)` Governs R1–R4.
- **Reply is a text artifact, not a second DOCX.** `(session-settled: user-approved — chosen over attaching a letter file: Gmail body is the send path)` Governs R5.
- **M8.1 is HTTP + smoke only.** `(session-settled: user-directed — drain row split: Gmail/in-process extract are M8.2–M8.4)` Governs scope.

### Requirements

Copied from inbox R1–R5 (do not drift):

- R1. Successful strict tailor returns non-empty `replyText` plus `cv`, `curatedJson`, `builderVersion`. Wrapper `{ curated_cv, reply_text }`. Schema-validate `curated_cv` only. Trim; usable iff non-empty.
- R2. Reply is a recruiter-thread email body, Master-CV-grounded, not flexible `coverLetter`.
- R3. Missing/non-string/whitespace-only `reply_text` on an otherwise valid strict result is 422 with no `.docx`, no curated JSON, no `replyText`.
- R4. Same single curator pass — not a second LLM call.
- R5. Strict `npm run smoke` writes the reply text next to existing artifacts (`tmp/smoke/<jd-slug>.reply.txt`).

### Scope Boundaries

- In: `curation-mode` wrapper helpers, `tailor-pipeline` extract/response, strict fallback prompt, smoke paths/write/runner, API + test docs, unit tests.
- Out: Gmail; Redis processed ids; in-process worker entry (M8.4); flexible `coverLetter` behavior; request-body model picker.
- Deferred: updating the live Langfuse `cv-curator-json` production prompt (fallback is the tested contract; operator syncs Langfuse).

### Acceptance Examples

- AE1. Strict curator JSON `{ curated_cv: <valid>, reply_text: "Thanks…" }` → 200 with `replyText` trimmed, no `coverLetter`. **Covers R1, R2.**
- AE2. Valid `curated_cv` but missing/blank `reply_text` → 422, no `cv` / `curatedJson` / `replyText`. **Covers R3.**
- AE3. Flexible wrapper unchanged; response has no `replyText`. **Covers R1 flexible clause.**
- AE4. Strict smoke success writes `<slug>.reply.txt` with the reply body. **Covers R5.**

## Planning Contract

### Key Technical Decisions

- KTD1. **Extend `curation-mode.ts` with `isCuratedCvWrapper` + `usableReplyText`; keep `isFlexibleWrapper` for cover-letter typing.** Instantiates R1. Existing `isFlexibleWrapper` already does 80% of wrapper detection.
- KTD2. **`runTailorCore` owns strict wrapper and usable `replyText` validation before schema/docx; `buildTailorResponse` is its HTTP adapter.** Instantiates R1, R3, R4. Bare master-schema JSON is no longer a successful strict result, and inbox tailoring invokes `runTailorCore` directly so validation is neither HTTP-only nor duplicated.
- KTD3. **Strict fallback `<output_format>` emits `{ curated_cv, reply_text }` (grounded, no invention).** Instantiates R2, R4. Langfuse production copy is operator follow-up.
- KTD4. **`smokeArtifactPaths` adds `replyPath`; write only in strict when `replyText` is a non-empty string; runner fails strict 200s that omit it.** Instantiates R5.

### Assumptions

- `runTailorCore` is the shared in-process owner of strict wrapper, usable `replyText`, schema, and DOCX readiness validation. `buildTailorResponse` adapts that result for HTTP, while inbox-tailor calls `runTailorCore` directly to avoid HTTP-only or duplicate validation.
- Live Langfuse prompt may still ask for bare CV JSON until the operator publishes; tests and fallback match the new contract.

### Sequencing

U1 (parse + pipeline) → U2 (prompt) → U3 (smoke) → U4 (docs).

## Implementation Units

### U1. Strict wrapper extract and `replyText`

- **Complexity:** Routine
- **Goal:** Strict success includes `replyText`; blank reply is 422.
- **Requirements:** R1, R3, R4
- **Files:** `app/api/lib/curation-mode.ts`, `app/api/lib/tailor-pipeline.ts`, `tests/curation-mode.test.ts`, `tests/flexible-curation.test.ts`, `tests/tailor-pipeline.test.ts`, `tests/route.test.ts`, `tests/critique-revise-loop.test.ts`, `tests/helpers/strict-curator.ts`
- **Approach:** Wrapper helper; pipeline strict branch; update success mocks to `{ curated_cv, reply_text }`.
- **Test scenarios:** usable trim; missing wrapper 422; missing/blank/non-string reply 422 with no artifacts; success includes trimmed `replyText` and omits `coverLetter`; flexible omits `replyText`.
- **Verification:** unit tests.

### U2. Strict curator fallback prompt

- **Complexity:** Routine
- **Goal:** Fallback tells the model to emit the wrapper plus grounded reply body.
- **Requirements:** R2, R4
- **Files:** `app/api/lib/curator-prompt.ts`, `app/api/lib/curation-mode.ts` (strict policy one-liner), `tests/curator-prompt.test.ts`
- **Approach:** Change strict `<output_format>` / process step 4; add reply grounding to strict `curationModePolicy`.
- **Test scenarios:** fallback matches `reply_text` and `curated_cv`; still omits page-count/visual QA.
- **Verification:** `tests/curator-prompt.test.ts`.

### U3. Strict smoke reply artifact

- **Complexity:** Routine
- **Goal:** Operator can read the email next to the CV.
- **Requirements:** R5
- **Files:** `app/api/lib/smoke-helpers.ts`, `app/api/lib/smoke-runner.ts`, `scripts/e2e-tailor-cv.ts`, `tests/smoke-helpers.test.ts`, `tests/smoke-runner.test.ts`, `tests/e2e-tailor-cv.test.ts`
- **Approach:** `replyPath` = `<slug>.reply.txt`. Write unredacted in strict when present. Runner requires non-empty `replyText` on strict 200.
- **Test scenarios:** nested path name; write on strict success; skip on flexible; runner fails strict 200 without `replyText`.
- **Verification:** unit tests.

### U4. Operator docs

- **Complexity:** Routine
- **Goal:** API and smoke docs match live HTTP.
- **Requirements:** R1, R5
- **Files:** `docs/api/API.md`, `docs/test/TESTING.md`, `CONCEPTS.md`, `docs/plans/README.md` (M8.1 plan link)
- **Approach:** Document `replyText`; smoke `.reply.txt`; keep leftover #38 / M7 lanes as on `main`.
- **Test expectation:** none beyond README link integrity.
- **Verification:** `tests/plans-readme.test.ts`.

## Verification Contract

| Command | Applies | Proves |
|---------|---------|--------|
| `node --test tests/curation-mode.test.ts tests/flexible-curation.test.ts tests/tailor-pipeline.test.ts` | U1 | Wrapper + 422 |
| Invert one new assertion | U1 or U3 | TDD red |
| `npm test` | After units | Suite (ignore pre-existing eval-results fails on main) |
| `npm run lint` | After | Clean |

## Definition of Done

- R1–R5 and AE1–AE4 hold.
- No Gmail or M8.4 worker extract in this change.
- Flexible `coverLetter` unchanged.
- M8.1 plan linked from the README (lane stays `lfg` until drain `awaiting-merge`).
