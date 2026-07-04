# Resolve "unknown" IP bucket global cross-user DoS

## Context

The recent migration to Upstash Redis for rate limiting (PR #X) changed the behavior of the `"unknown"` IP fallback.

When `TRUSTED_PROXIES` is empty or the client IP cannot be resolved, `route.ts` assigns the identifier `"unknown"`. Previously, this bucket was limited to 5 requests per minute *per container* and reset on deploys. Now, it is a **global shared bucket** in Redis.

If a single bad actor (or misconfigured proxy) exhausts this bucket, all other unidentified legitimate traffic will receive a `429 Too Many Requests`.

## Action Required

Create a separate, focused PR to address this API policy change (kept separate from the Redis infra PR to isolate rollback risk).

**Options for the fix:**
1. **Strict Policy (Recommended):** If `parseClientIp` yields `"unknown"`, throw a `400 Bad Request: Cannot determine client IP`. This forces infrastructure/proxy misconfigurations to be fixed rather than silently collapsing traffic.
2. **Session Fallback:** If `ip` cannot be resolved, fall back to using the `sessionId` from the request body as the rate-limit identifier, so un-proxied users are at least isolated by session.

## Review Notes

This was flagged as a P1 issue by the Tier 2 security review, but deferred to a fast-follow PR to avoid conflating infrastructure swaps with API policy changes.
