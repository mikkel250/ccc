---
status: ready
priority: p2
issue_id: 004
tags: [code-review, standards, config]
dependencies: []
---

# New Environment Variables Not Fully Documented in `.env.example`

## Problem Statement

The AGENTS.md mandates: *"Every new environment variable must appear in `.env.example` with a comment describing its purpose and default."* Several new env vars from this cutover were flagged by the project-standards-reviewer as missing, incomplete, or with incorrect defaults in `.env.example`.

## Findings

- **Location:** `.env.example` diff in the PR
- **Evidence:** The diff shows `.env.example` was modified (+31 lines) but several new env vars may not be fully documented. The following need verification:
  - `TAILOR_API_KEY` — shared secret for auth gate
  - `TAILOR_AUTH_INSECURE_BYPASS` — local dev bypass
  - `MASTER_CV_JSON` / `MASTER_CV_PATH` — master CV source
  - `TAILOR_JD_MAX_CHARS` — JD size limit
  - `TAILOR_CURATED_MAX_BYTES` — curated JSON size limit
  - `TAILOR_RESPONSE_MAX_BYTES` — total response size limit
  - `RATE_LIMIT_SECRET_MAX` — per-secret rate limit ceiling
  - `LANGFUSE_REDACT_ENABLED` — Langfuse content redaction flag (if added)

## Proposed Solutions

1. **Audit all new `getEnv*` calls and add every one to `.env.example`:** Grep for `getEnvNumber`, `getEnvString`, `getEnvBoolean` in changed files; ensure each has a corresponding entry in `.env.example` with documented purpose and default value.
   - Pros: Meets AGENTS.md requirement exactly
   - Cons: Manual audit needed
   - Effort: Small
   - Risk: Low

## Recommended Action

Audit and update `.env.example`.

## Technical Details

- **Affected files:** `.env.example`
- **No code changes** (documentation only)
- **No test changes**

## Acceptance Criteria

- [ ] Every `getEnvNumber`/`getEnvString`/`getEnvBoolean` call in changed `lib/` files has a corresponding entry in `.env.example`
- [ ] Every entry has a comment describing purpose and default
- [ ] Entries are in a logical grouping order

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | Flagged by project-standards-reviewer |
| 2026-07-20 | Verified | Audited all getEnv* calls in changed files — .env.example is complete for all new vars |

## Resources

- Rule: `AGENTS.md` — "`.env.example` is the canonical env var catalog"
- Source: `.env.example` diff
