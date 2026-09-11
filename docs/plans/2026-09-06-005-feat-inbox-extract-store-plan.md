---
title: "feat: Inbox body extract and processed-id store"
date: 2026-09-06
type: feat
topic: inbox-extract-store
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: docs/plans/2026-09-05-002-feat-inbox-worker-plan.md
execution: code
---

# feat: Inbox body extract and processed-id store

## Goal Capsule

- **Objective:** Turn a Gmail message resource into a job-description string, and persist claim vs processed `messageId`s in Redis so a second extract after the terminal mark is a no-op.
- **Authority:** Inbox product contract R7, R10 (claim vs processed), R12 in `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`. Board: M8.3 in `docs/plans/README.md`.
- **Open blockers:** None.
- **Stop when:** `text/plain` (else html-to-text) extract works; SET NX claim has one winner; processed mark skips extract; crash before processed does not treat the claim as terminal (recovery after the claim key expires or is released — a live claim still returns `skipped-claimed`). No tailor, no Gmail drafts, no `inbox:scan` job. Draft reconciliation is M8.5.

## Product Contract

### Summary

M8.3 is library-only: body extract (R7) plus Redis claim/processed (R10/R12). Scan fetch/tailor/draft stay later rows. This branch is from `main`, so it does not import M8.2 Gmail list/auth.

### Problem Frame

Overlapping local and Railway scans must not double-extract; the JD must come from the message body, not a second model.

### Key Decisions

- **Claim is SET NX and is not processed.** `(session-settled: user-directed — R10/R12)` Rejected: using the claim key as the terminal mark.
- **Processed is written only by `markInboxProcessed` (M8.5 caller).** `(session-settled: user-directed — R10: mark after draft exists)` Rejected: marking processed after extract.
- **Extract is a pure function of the Gmail JSON payload.** `(session-settled: user-approved — M8.2 list/auth is a separate PR; fetch `messages.get` is scan wiring)` Rejected: stacking this PR on unmerged M8.2.

### Requirements

- R7. JD = message body, `text/plain` else html-to-text. No JD-isolation model.
- R10. Atomic claim of `messageId` before later tailor/draft. Claim ≠ processed.
- R12. Processed ids persist in Upstash Redis. This row implements key layout + TTL via env.

### Scope Boundaries

- In: extract walker, html-to-text, Redis claim/processed, env catalog, unit tests (concurrent claim; recovery before processed).
- Out: Gmail OAuth/list (M8.2); `messages.get` HTTP (scan); in-process tailor (M8.4); drafts (M8.5); Railway (M8.6); `npm run inbox:scan`.

### Acceptance Examples

- AE1. Multipart with plain + html → plain text. HTML-only → stripped text. **Covers R7.**
- AE2. Two concurrent claims → one `won`. **Covers R10.**
- AE3. After `markInboxProcessed`, extract is skipped. Claim without processed still allows a later win after the claim key is gone (TTL expiry or explicit release on extract failure). A live claim does not inspect Gmail drafts. **Covers R12, crash recovery.** Gmail existing-draft reconcile stays M8.5.

## Planning Contract

### Key Technical Decisions

- KTD1. **Keys `{INBOX_REDIS_PREFIX}:claim:{id}` and `{INBOX_REDIS_PREFIX}:processed:{id}`.** Prefix default `inbox`. Claim SET NX + EX `INBOX_CLAIM_TTL_SECONDS` (default 900). Processed SET; `INBOX_PROCESSED_TTL_SECONDS` 0 = no expiry.
- KTD2. **Walk Gmail `payload` / `parts`; prefer `text/plain`; else strip HTML.** Instantiates R7. No new npm dependency.
- KTD3. **Inject an `InboxKv` in tests; production uses `getRedisClient()`.** Matches rate-limit injection.

### Sequencing

U1 (extract) → U2 (Redis store) → U3 (compose skip) → U4 (docs).

## Implementation Units

### U1. Gmail body → JD string

- **Files:** `app/api/lib/gmail-body.ts`, `tests/gmail-body.test.ts`
- **Tests:** plain preferred; html fallback; nested multipart; empty → error; base64url.

### U2. Claim / processed Redis

- **Files:** `app/api/lib/inbox-processed-store.ts`, `app/api/lib/inbox-config.ts`, `tests/inbox-processed-store.test.ts`, `.env.example`
- **Tests:** NX one winner; processed skips; invalid id never writes.

### U3. Extract-if-unprocessed

- **Files:** same store module
- **Tests:** processed → skip; lost claim → skip; won + payload → JD, not processed.

### U4. Docs

- **Files:** `docs/plans/README.md`, `docs/arch/FILE_LAYOUT.md`, `docs/test/TESTING.md`, `.env.example`
- **Note:** leftover #38 / M7 / M8.1 / M8.2 lanes stay as on `main`.

## Definition of Done

- R7, R10 claim semantics, R12 store hold.
- No tailor, drafts, or Gmail HTTP in this change.
- README lane stays `lfg` until drain `awaiting-merge`.
