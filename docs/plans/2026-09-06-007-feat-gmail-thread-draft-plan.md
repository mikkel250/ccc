---
title: "feat: Gmail thread draft with CV attach"
date: 2026-09-06
type: feat
topic: gmail-thread-draft
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: docs/plans/2026-09-05-002-feat-inbox-worker-plan.md
execution: code
---

# feat: Gmail thread draft with CV attach

## Goal Capsule

- **Objective:** After a successful in-process strict tailor, create at most one Gmail reply draft on that thread with `replyText` as the body and the CV `.docx` attached, then mark the message processed. Local `npm run inbox:scan` is the proof trigger.
- **Authority:** Inbox product contract R10, R11, R12, R13 (scan script), R9 (serial) in `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`. Board: M8.5.
- **Open blockers:** None.
- **Stop when:** Existing thread draft is reused (no second create); processed mark is written only after a draft exists; blank/missing reply creates no stub draft; Railway cron is not in this row.

## Product Contract

### Summary

M8.5 is draft + scan: `messages.get` → `tailorLabeledMessage` → `drafts.create` (or reuse) → `markInboxProcessed`. Stacked on unmerged M8.1–M8.4 so the scan has list, extract, `replyText`, and in-process core.

### Key Decisions

- **Scan script is in this row.** `(session-settled: user-directed — AE3 / Unblocks: local scan creates the Gmail draft; M8.6 is the same job on a schedule)` Rejected: library-only drafts without `inbox:scan`.
- **Reuse any DRAFT-labeled message on the thread; do not create a second.** `(session-settled: user-directed — R10 / AE6)` Rejected: always creating; rejected: rewriting an existing draft’s body in this row.
- **Processed mark only after create or reuse.** `(session-settled: user-directed — R10)` Rejected: marking on tailor success (M8.4 already forbids that).
- **No Railway cron here.** `(session-settled: user-directed — drain row split M8.6)` Governs scope.

### Requirements

- R10. At most one reply draft (body = `replyText`, CV `.docx` attached). Claim before tailor. Reuse existing thread draft. Mark processed only after a draft exists.
- R11. Missing reply after tailor → no stub draft.
- R12. Processed ids persist so a rerun does not tailor or draft again.
- R13. `npm run inbox:scan` is the local proof trigger.
- R9. Serial batch with backoff (env).

### Scope Boundaries

- In: `messages.get`, RFC2822 MIME + `drafts.create`, thread draft detect, `inbox:scan`, processed mark after draft, tests, docs.
- Out: Railway schedule (M8.6); schedule-send; cover-letter `.docx` attach; rewriting existing draft MIME; live Gmail in `npm test`.

### Acceptance Examples

- AE1. Tailor success → one `drafts.create` with reply body + attachment; processed key set. **Covers R10, R12.**
- AE2. Thread already has a DRAFT → no second create; processed key set. **Covers R10, AE6 / crash before mark.**
- AE3. Strict 422 / blank reply → no draft, no processed mark. **Covers R11.**
- AE4. `npm run inbox:scan` exists and walks listed messages serially. **Covers R13, R9.**

## Planning Contract

### Key Technical Decisions

- KTD1. **Injected `fetch`; no `googleapis` SDK.** Matches M8.2.
- KTD2. **`users.threads.get` + `labelIds` contains `DRAFT` means reuse.** Instantiates R10 without storing draft ids in Redis.
- KTD3. **`drafts.create` `message.raw` is base64url(RFC2822 multipart/mixed)** with `threadId`. Attachment filename from `GMAIL_CV_ATTACHMENT_FILENAME` (default `CV.docx`).
- KTD4. **`INBOX_SCAN_BACKOFF_MS` between messages** (default 1000). Instantiates R9.

## Implementation Units

### U1. Reply MIME + draft reuse/create

- **Files:** `app/api/lib/gmail-drafts.ts`, `app/api/lib/gmail-message.ts`, `app/api/lib/gmail-config.ts`, `tests/gmail-drafts.test.ts`
- **Tests:** MIME contains body + filename; reuse skips POST; create posts once; missing From fails closed.

### U2. Scan job

- **Files:** `app/api/lib/inbox-scan.ts`, `scripts/inbox-scan.ts`, `package.json`, `tests/inbox-scan.test.ts`
- **Tests:** 422 skips draft; success marks processed; existing draft reuses; processed skip avoids tailor.

### U3. Docs

- **Files:** `docs/plans/README.md`, `docs/arch/FILE_LAYOUT.md`, `docs/api/API.md`, `docs/test/TESTING.md`, `.env.example`

## Definition of Done

- R9–R13 hold for local scan. No Railway cron. No second draft after crash-before-mark.
