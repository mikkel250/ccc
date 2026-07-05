---
status: pending
priority: p2
issue_id: "009"
tags: [code-review, performance, rate-limit, denial-of-service]
dependencies: []
---

# Reorder IP check before JSON body parsing to close rate-limit bypass

## Problem Statement

In `app/api/tailor-cv/route.ts`, `request.json()` is parsed **before** `parseClientIp(request)` runs. When `x-forwarded-for` is missing or invalid, the handler returns `400 { error: "Cannot determine client IP" }` without ever calling `checkRateLimit`. This means an attacker can send valid JSON bodies without `x-forwarded-for` and consume server CPU (JSON parsing) indefinitely without hitting any rate limit.

**Severity: P2.** The plan intentionally rejects unresolvable IPs before rate limiting (to prevent the "unknown" shared-bucket DoS), but the current ordering still allows body parsing before the IP check. JSON parsing is cheap relative to LLM calls, but reordering is trivial and closes the gap completely.

## Findings

- **Performance Oracle (CRITICAL flag, downgraded to P2):** "The early 400 return introduces a rate-limit bypass vector." Body parsing still occurs before the reject.
- **Security Sentinel:** Medium-severity — XFF-only IP resolution has no fallback. Combined with the ordering, this means the entire body-parsing path is un-rate-limited when XFF is absent.

**Current ordering in `POST` handler:**
```
1. request.json()          ← body parsed (CPU cost)
2. parseClientIp(request)  ← IP resolution
3. ipAddress === "unknown" → 400  ← rate limit never reached
4. ... checkRateLimit(...)  ← rate limit checkpoint
```

## Proposed Solutions

### Option A: Reorder — check IP before JSON parsing (Recommended)

Move `parseClientIp(request)` and the 400 check above `request.json()`. The IP resolution only reads headers, not the body, so this is safe.

**Pros:** Closes the bypass completely; no body parsing cost for unresolvable requests.
**Cons:** Slight reordering of error responses — malformed JSON still returns 400 "Invalid JSON", but unresolvable IP now returns 400 "Cannot determine client IP" first.
**Effort:** Small
**Risk:** Low — pure reorder, same logic.

### Option B: Rate-limit unresolvable IPs with a small fixed bucket

Apply a separate, small rate limit (e.g., 10 req/s) for requests with unresolvable IPs — keyed on a constant identifier.

**Pros:** Preserves current ordering; doesn't break existing error response priority.
**Cons:** Adds complexity; the "unknown" bucket problem this PR fixes; JSON parsing cost still incurred.
**Effort:** Medium
**Risk:** Medium — introduces a new rate-limit path.

### Option C: Accept the tradeoff (do nothing)

**Pros:** No code change; JSON parsing is extremely cheap compared to LLM calls.
**Cons:** Leaves a theoretical bypass; violates "defense in depth" principle.
**Effort:** None
**Risk:** Low — practical impact negligible.

## Technical Details

- **Affected files:** `app/api/tailor-cv/route.ts`
- **Components:** `parseClientIp`, `POST` handler body
- **No database changes**

## Acceptance Criteria

- [ ] `parseClientIp` and the 400 check execute before `request.json()`
- [ ] `npm test` passes — test expectations for error response ordering are updated if needed
- [ ] `npm run build` passes
- [ ] Malformed JSON with missing XFF still returns 400 (either "Cannot determine client IP" or "Invalid JSON" — both are acceptable, but behavior is documented)

## Work Log

### 2026-07-04 — Finding created

**By:** Multi-agent code review (performance-oracle, security-sentinel)

**Actions:** None yet.

## Resources

- PR branch: `feature/rate-limit-unknown-ip-fastfollow`
- Plan: `docs/plans/2026-07-04-001-fix-rate-limit-client-ip-resolution-plan.md`
- Related todo: `todos/000-pending-p1-resolve-unknown-ip-global-bucket.md` (resolved by this PR)
