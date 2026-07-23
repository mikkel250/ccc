---
status: done
priority: p3
issue_id: "019"
tags: [code-review, http, api, standards]
dependencies: []
---

# No `Retry-After` HTTP header on 429 rate-limit responses

## Problem Statement

`POST /api/tailor-cv` returns 429 with `remaining` and `resetTime` in the JSON body but omits the standard `Retry-After` HTTP response header. Programmatic HTTP clients that parse standard headers (not JSON bodies) for backoff will not see the retry window.

## Findings

- **File:** `app/api/tailor-cv/route.ts` — two 429 response sites (rate-limit deny and `RateLimitError` catch)
- **Standard:** RFC 7231 §7.1.3 / RFC 6585 §4 — `Retry-After: <http-date>` or `Retry-After: <delay-seconds>`
- **Data available:** `resetTime` in `RateLimitResult` is a Unix timestamp in seconds — trivially convertible to `delay-seconds = max(1, resetTime - Date.now()/1000)`

## Proposed Solutions

### Option A: Add `Retry-After` header to both 429 sites
- **Effort:** Trivial
- **Risk:** None
- **Approach:** Compute `retryAfterSeconds = Math.max(1, Math.ceil(resetTime - Date.now() / 1000))` and pass via headers to `jsonResponse` (or add a helper that accepts headers)

## Technical Details

- **Affected files:** `app/api/tailor-cv/route.ts`
- **Components:** HTTP response headers
- **Database changes:** None

## Acceptance Criteria

- [x] Primary 429 path (rate-limit deny) includes `Retry-After` header
- [x] `retryAfterSeconds` computed as `Math.max(1, Math.ceil(resetTime - now))`
- [x] All rate-limit and route tests pass
- [x] `RateLimitError` path (unexpected throw) omitted — no `resetTime` available on the error class

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-22 | Created from code review | agent-native-reviewer |
| 2026-07-22 | Resolved — added header | `jsonResponse` extended with optional `extraHeaders`; `retryAfterSeconds` helper computes delay from `resetTime`. Primary rate-limit deny path includes `Retry-After`. `RateLimitError` catch path omitted (no resetTime on the error class). |

## Resources

- File: `app/api/tailor-cv/route.ts`
- Tests: `tests/route.test.ts`
