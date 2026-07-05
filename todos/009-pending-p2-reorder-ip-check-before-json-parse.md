---
status: completed
priority: p2
issue_id: "009"
tags: [code-review, performance, rate-limit, denial-of-service]
dependencies: []
---

# Reorder IP check before JSON body parsing to close rate-limit bypass

## Resolution

**Closed — already implemented.** `POST` in `app/api/tailor-cv/route.ts` resolves the client IP and rejects unresolvable requests before `request.json()` runs. The JSON-parse-before-IP bypass described in the original finding is no longer active behavior.

## Current ordering in `POST` handler

```
1. parseClientIp(request)  ← IP resolution (headers only)
2. ipAddress === "unknown" → 400 { error: "Cannot determine client IP" }
3. request.json()          ← body parsed only after IP is known
4. validateTailorCvBody(...)
5. checkRateLimit(sessionId, ipAddress)
```

Malformed JSON without `x-forwarded-for` returns **400 "Cannot determine client IP"** (IP check wins). Valid IP with bad JSON returns **400 "Invalid JSON in request body"**.

## Original problem (historical)

When `request.json()` ran before `parseClientIp`, requests missing `x-forwarded-for` could consume JSON-parse CPU without ever reaching `checkRateLimit`. Reordering closed that gap.

## Acceptance Criteria

- [x] `parseClientIp` and the 400 check execute before `request.json()`
- [x] `npm test` passes — `returns 400 for missing IP before attempting JSON parse` in `tests/route.test.ts`
- [x] Malformed JSON with missing XFF returns 400 "Cannot determine client IP" (IP-first ordering)

## Work Log

### 2026-07-04 — Finding created

**By:** Multi-agent code review (performance-oracle, security-sentinel)

**Actions:** None yet.

### 2026-07-04 — Verified and closed

**By:** Code review follow-up

**Actions:** Confirmed `route.ts` lines 48–64: `parseClientIp` → unknown-IP 400 → `request.json()`. Test at `tests/route.test.ts` asserts IP error precedes JSON parse for trailing-comma body without XFF. No code change required.

## Resources

- PR branch: `feature/rate-limit-unknown-ip-fastfollow`
- Plan: `docs/plans/2026-07-04-001-fix-rate-limit-client-ip-resolution-plan.md`
- Related todo: `todos/000-pending-p1-resolve-unknown-ip-global-bucket.md` (completed)
