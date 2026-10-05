---
title: "feat: Gmail auth and labeled-mail list"
date: 2026-09-06
type: feat
topic: gmail-auth-list
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: docs/plans/2026-09-05-002-feat-inbox-worker-plan.md
execution: code
---

# feat: Gmail auth and labeled-mail list

## Goal Capsule

- **Objective:** Operator can mint `GMAIL_REFRESH_TOKEN` locally and list Gmail messages that carry the recruiter label, without creating drafts.
- **Authority:** Inbox product contract R6, R13, R15, R16 in `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`. Board: M8.2 in `docs/plans/README.md`.
- **Open blockers:** None.
- **Stop when:** `npm run gmail:auth` is a one-shot loopback CLI; `npm run gmail:list` prints labeled message ids using the refresh token; no drafts, no Redis processed ids, no tailor.

## Product Contract

### Summary

M8.2 is Gmail **read + identity** only: Desktop-app OAuth loopback to mint a refresh token, then list messages for `GMAIL_RECRUITER_LABEL`. Later rows reuse that token.

### Problem Frame

Inbox scan cannot start until the process can authenticate as the operator's mailbox and see labeled recruiter mail.

### Key Decisions

- **One-shot CLI, not a Next.js OAuth route.** `(session-settled: user-directed — R15 / R16: no product OAuth UI; tokens stay server-side)` Governs R15, R16. Rejected: localhost Next route as the redirect target.
- **Scope is `gmail.modify` now.** `(session-settled: user-approved — inbox contract already names compose/modify as operator setup; one refresh token must cover M8.5 drafts without a second consent)` Governs R6 + later R10. Rejected: `gmail.readonly` for this row (would force re-auth).
- **List only; no drafts.** `(session-settled: user-directed — drain row split)` Governs scope. Rejected: creating reply drafts here.

### Requirements

Copied from inbox R6 / R13 / R15 / R16 (do not drift):

- R6. List Gmail messages with `GMAIL_RECRUITER_LABEL`.
- R13. Documented on-demand scripts include `gmail:auth` and list (`gmail:list`).
- R15. One-shot local CLI mints `GMAIL_REFRESH_TOKEN`; Railway uses that token. No product OAuth UI.
- R16. Gmail tokens stay server-side. Seekers and browsers never hold them.

### Scope Boundaries

- In: env catalog, OAuth URL/token helpers, loopback auth CLI, label resolve + `messages.list`, operator docs, unit tests with injected fetch.
- Out: body extract (M8.3); Redis claim/processed ids (M8.3); in-process tailor (M8.4); Gmail drafts/MIME (M8.5); Railway cron (M8.6); Next.js OAuth routes.
- Deferred: pagination beyond `GMAIL_LIST_MAX_RESULTS` first page; live Gmail in `npm test`.

### Acceptance Examples

- AE1. `gmail:auth` starts a `127.0.0.1` listener, prints an authorize URL (`access_type=offline`, `prompt=consent`, `gmail.modify`, PKCE), exchanges the code, writes `GMAIL_REFRESH_TOKEN` to a mode-0600 file, and prints only that file path (never the token on stdout). **Covers R15, R16.**
- AE2. `gmail:list` with a valid token and label prints message `id` / `threadId` for that label; unknown label fails closed. **Covers R6, R13.**
- AE3. Missing client id / secret / refresh token / label fails with the env var name, never logging token values. **Covers R16.**

## Planning Contract

### Key Technical Decisions

- KTD1. **Desktop-app loopback (`http://127.0.0.1:<ephemeral-port>`), bind host refuses `0.0.0.0`.** Instantiates R15, R16. Google deprecated OOB.
- KTD2. **Injected `fetch` for token + Gmail REST; no `googleapis` SDK.** Instantiates R6. Matches existing HTTP clients; keeps tokens out of extra client objects.
- KTD3. **Resolve label name → id via `users.labels.list`, then `users.messages.list?labelIds=`.** Instantiates R6. Label names are operator-facing; Gmail list wants ids.
- KTD4. **`gmail.modify` default scope via `GMAIL_OAUTH_SCOPE`.** Instantiates one-shot token for M8.5. Env-overridable.

### Assumptions

- Operator creates a Google Cloud Desktop OAuth client and enables the Gmail API (inbox contract: operator setup).
- Testing-status Google apps expire refresh tokens after ~7 days; operator publishes the consent screen for Railway.

### Sequencing

U1 (config + token) → U2 (list) → U3 (auth CLI) → U4 (docs).

## Implementation Units

### U1. Gmail env + token refresh

- **Complexity:** Routine
- **Goal:** Refresh an access token from env without printing secrets.
- **Requirements:** R15, R16
- **Files:** `app/api/lib/gmail-config.ts`, `app/api/lib/gmail-oauth.ts`, `tests/gmail-oauth.test.ts`, `.env.example`
- **Approach:** Required env getters throw `ServiceError` naming the key. Validate token JSON as `unknown`.
- **Test scenarios:** missing env; successful refresh; HTTP error; malformed JSON; bind host `0.0.0.0` rejected.
- **Verification:** unit tests.

### U2. List labeled messages

- **Complexity:** Routine
- **Goal:** Return `{ id, threadId }[]` for the recruiter label.
- **Requirements:** R6
- **Files:** `app/api/lib/gmail-list.ts`, `tests/gmail-list.test.ts`
- **Approach:** labels.list → match name → messages.list. Empty list is ok. Unknown label is an error.
- **Test scenarios:** match; case-insensitive fallback; missing label; empty messages; first-page cap.
- **Verification:** unit tests.

### U3. Auth and list CLIs

- **Complexity:** Routine
- **Goal:** Operator scripts exist and are testable without a live Google account.
- **Requirements:** R13, R15
- **Files:** `scripts/gmail-auth.ts`, `scripts/gmail-list.ts`, `package.json`, `tests/gmail-auth.test.ts`
- **Approach:** Auth CLI uses loopback + state + PKCE; writes refresh token to a mode-0600 file and prints only the path. List CLI prints JSON lines of id/threadId.
- **Test scenarios:** auth URL query params (including PKCE); callback state mismatch; token file path-only stdout (no secret on terminal); list CLI maps library result.
- **Verification:** unit tests (no live Gmail).

### U4. Operator docs

- **Complexity:** Routine
- **Goal:** Scripts and env vars are discoverable.
- **Requirements:** R13, R16
- **Files:** `docs/api/API.md`, `docs/test/TESTING.md`, `docs/arch/FILE_LAYOUT.md`, `CONCEPTS.md`, `docs/plans/README.md`
- **Approach:** Document Desktop client + `gmail:auth` / `gmail:list`. Keep leftover #38 / M7 / M8.1 lanes as on `main`.
- **Verification:** `tests/plans-readme.test.ts`.

## Verification Contract

| Command | Applies | Proves |
|---------|---------|--------|
| `node --import ./tests/set-node-env-test.mjs --import tsx --test tests/gmail-oauth.test.ts tests/gmail-list.test.ts tests/gmail-auth.test.ts` | U1–U3 | Auth + list |
| Invert one new assertion | U1 | TDD red |
| `npm test` | After units | Suite (ignore pre-existing eval-results fails on main) |
| `npm run lint` | After | Clean |

## Definition of Done

- R6, R13, R15, R16 and AE1–AE3 hold.
- No Gmail drafts, Redis processed ids, or in-process tailor in this change.
- M8.2 plan linked from the README (lane stays `lfg` until drain `awaiting-merge`).
