# fix: Resolve Rate-Limit Client IP Resolution and Unknown-IP DoS Bucket

**Created:** 2026-07-04
**Branch:** `feature/rate-limit-unknown-ip-fastfollow`

## Summary

Verifying the Upstash Redis rate limiter (`npm test`, `npm run build`, `tsc --noEmit`) surfaced two real defects, not just coverage gaps: `npm run build` currently fails (`ServiceError` doesn't accept the `cause` option `rate-limit.ts` already passes it), and `NextRequest.ip` — the property `parseClientIp` depends on — was removed in Next.js 15. The second defect means the connecting-peer IP is `undefined` for every request in production today, so the `TRUSTED_PROXIES` peer-check never executes and **all traffic collapses into the single global "unknown" Redis bucket** described in `todos/000-pending-p1-resolve-unknown-ip-global-bucket.md` — unconditionally, not just when `TRUSTED_PROXIES` is misconfigured. This plan fixes the build, redesigns client-IP resolution around what a Next.js Route Handler can actually see on Railway, closes `todos/000`, and adds a live smoke-test script the user will run with real Upstash credentials.

---

## Problem Frame

- `npm run build` fails: `app/api/lib/rate-limit.ts:107` calls `new ServiceError(message, { cause: error })`, but `ServiceError`'s constructor only accepts `message`. TypeScript rejects the call; the error path's `cause`-preservation (documented as already working in `docs/solutions/upstash-redis-rate-limit-migration.md`) has never actually compiled.
- `app/api/tailor-cv/route.ts:28` reads `request.ip`, a property Next.js 15 removed from `NextRequest` (confirmed via `tsc --noEmit` and Next.js's v15 upgrade guide). There is no hosting-provider-agnostic replacement built into the framework, and `@vercel/functions` only works on Vercel — this app deploys on Railway (`docs/arch/README.md`).
- Consequence: `parseClientIp`'s `TRUSTED_PROXIES` peer-validation branch is unreachable dead code. Every request's `peerIp` is `"unknown"`, so `isValidIp(peerIp)` fails and the function always returns `"unknown"` — the exact global shared-bucket DoS risk `todos/000` flags, except unconditional rather than configuration-dependent.
- `todos/000-pending-p1-resolve-unknown-ip-global-bucket.md` was explicitly deferred to a fast-follow PR after the Redis migration merged (`docs/solutions/upstash-redis-rate-limit-migration.md` cross-references it as still open).

---

## Requirements

- `npm run build` and `npm test` pass with no type errors introduced by the rate-limit/error-handling code path.
- Client IP resolution works within the constraints of a Next.js 15 Route Handler on Railway (no raw peer-socket access, no `@vercel/functions`).
- The rate limiter no longer pools all unidentified traffic into one shared global bucket; a request whose IP truly cannot be determined is rejected outright rather than silently sharing state with every other unresolved request.
- `todos/000-pending-p1-resolve-unknown-ip-global-bucket.md` is closed out (status + resolution recorded) once the fix lands.
- A live/manual verification path exists for exercising the real Upstash-backed limiter once credentials are configured, separate from the existing mocked unit tests.

---

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| Trust the **rightmost** `x-forwarded-for` entry as the client IP; drop `TRUSTED_PROXIES` and the peer-check entirely | `NextRequest` exposes no raw connecting-peer address in Next.js 15 Route Handlers, so "verify the immediate peer is a trusted proxy" cannot be implemented here. The proxy closest to the server (Railway's edge) appends whatever it observed to the *end* of the header, regardless of what a client injects at the front — true whether Railway overwrites or appends to client-supplied XFF. Rightmost is never less safe than leftmost, and is safe without needing to know Railway's exact proxy behavior. |
| Reject with `400 Bad Request` when the IP still resolves to `"unknown"` | Matches the todo's recommended option. Forces infra/header misconfiguration to surface immediately instead of silently pooling into a shared bucket. |
| Give `ServiceError` an optional `options: ErrorOptions` constructor parameter, forwarded via `super(message, options)` | Restores the `cause`-preservation the Upstash migration already assumed and documented, without changing any existing single-argument call sites (`knowledge-base.ts`, tests). Unblocks `npm run build`. |
| Remove `TRUSTED_PROXIES` from `.env.example` and `route.ts` | Dead configuration once the peer-check is gone — keeping it would be a silently-ignored env var (a footgun `AGENTS.md`'s "every literal value is a future outage" heuristic exists to prevent). |
| Live smoke-test script imports `checkRateLimit` directly rather than driving it through `POST /api/tailor-cv` | Isolates real-Redis rate-limit behavior from LLM/knowledge-base dependencies the user hasn't necessarily configured; mirrors the graceful-skip-without-credentials pattern already used by `scripts/e2e-tailor-cv.ts`. |

---

## Implementation Units

### U1. Fix `ServiceError` cause propagation (unblocks `npm run build`)

**Goal:** Restore the `cause`-preservation behavior `rate-limit.ts` already relies on, and get `npm run build` passing again.

**Requirements:** Build/test-pass requirement above.

**Dependencies:** None.

**Files:**
- `app/api/lib/errors.ts` — modify
- `tests/errors.test.ts` — modify

**Approach:** Add an optional second constructor parameter to `ServiceError`, typed as `ErrorOptions`, forwarded to `super(message, options)`. `RateLimitError` is unaffected (no call site passes a second argument). No changes needed at the `rate-limit.ts` call site — it already passes `{ cause: error }`.

**Patterns to follow:** Native `Error` cause support (`super(message, options)`); the class already extends `Error` and sets `this.name`.

**Test scenarios:**
- Happy path: `new ServiceError(message, { cause: originalError }).cause === originalError`.
- Backward compatibility: `new ServiceError(message)` (no second argument) still constructs correctly with `cause` left `undefined` — covers all existing single-argument call sites (`knowledge-base.ts`).
- Integration: in `tests/rate-limit.test.ts`, the existing "throws ServiceError when `Ratelimit.limit()` rejects" test additionally asserts `err.cause` is the original thrown error, not just the wrapper's message/name.

**Verification:** `npm run build` completes with no type errors; `npm test` passes; the cause-assertion test passes.

---

### U2. Fix client IP resolution and enforce the unknown-IP reject policy

**Goal:** Make `parseClientIp` work under Next.js 15's actual API surface, stop pooling all unresolved traffic into one bucket, and close `todos/000`.

**Requirements:** Client-IP-resolution and no-shared-bucket requirements above; closes `todos/000-pending-p1-resolve-unknown-ip-global-bucket.md`.

**Dependencies:** U1 (shares the route's error-handling path; sequencing avoids touching the same file's build-breaking area twice).

**Files:**
- `app/api/tailor-cv/route.ts` — modify (`parseClientIp`, `POST` handler, remove `TRUSTED_PROXIES`)
- `.env.example` — modify (remove `TRUSTED_PROXIES` entry)
- `tests/route.test.ts` — modify
- `todos/000-pending-p1-resolve-unknown-ip-global-bucket.md` — modify (close out with resolution)

**Approach:**
- Rewrite `parseClientIp(request)`: read `x-forwarded-for` only, split on `,`, trim entries, take the **last** non-empty entry, validate with the existing `isValidIp`. No match → return `"unknown"`. Drop `request.ip`, `TRUSTED_PROXIES`, and `x-real-ip` handling — all three were only meaningful under the now-impossible peer-validation design.
- In `POST`, immediately after computing `ipAddress`, if it's `"unknown"`, return `400 { error: "Cannot determine client IP" }` before body validation or rate limiting — do not let it reach `checkRateLimit`.
- Remove the `TRUSTED_PROXIES` `Set` construction and its `getEnvString` import usage if no longer needed elsewhere in the file.
- Update `todos/000-*.md`: add the same YAML frontmatter shape used by `todos/001`–`008` (`status: completed`, `priority: p1`, `issue_id: "000"`), and append a short resolution note pointing at this plan and the rightmost-XFF decision.

**Patterns to follow:** `isValidIp` stays unchanged. Error-status mapping already follows the `RateLimitError` → 429 / `ServiceError` → 503 / generic → 500 pattern in the same `catch` block — the new 400 is a direct early return, consistent with the existing malformed-JSON 400 a few lines above it.

**Test scenarios:**
- Happy path: single `x-forwarded-for` entry (the common Railway case) is used as the rate-limit identifier; burst-then-block behavior across `maxRequests` requests still works (adapts the existing burst test to the new resolution logic).
- Edge — anti-spoofing: `x-forwarded-for: "203.0.113.1, 198.51.100.9"` (two entries) uses the **rightmost** (`198.51.100.9`) as the identifier, not the leftmost — replaces/renames the old "parses x-forwarded-for to leftmost IP" test, which encoded the now-rejected trust model.
- Edge: `x-forwarded-for` header missing entirely → `400 { error: "Cannot determine client IP" }`, not `429` and not a rate-limit-consuming request — replaces the old "uses 'unknown' IP when forwarding headers are missing" test, which asserted the very pooling behavior this plan removes.
- Edge: `x-forwarded-for` present but contains no valid IP (e.g. `"not-an-ip"`) → same `400` behavior.
- Integration: confirm the 400 response is returned before `tailorCvDeps.checkRateLimit` is invoked (no wasted rate-limit-bucket consumption on unresolvable requests) — assert via a `mock.method` call-count check or by confirming no rate-limit fields appear on the 400 response body.

**Verification:** `npm test` passes with the updated `route.test.ts` scenarios; `npm run build` passes; manually confirm `todos/000-*.md` reads as resolved with a clear pointer to this plan.

---

### U3. Live smoke-test script for the real Upstash-backed limiter

**Goal:** Give the user a manual/live verification path for the real Redis-backed rate limiter, to run once they've added `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` to their local `.env`.

**Requirements:** Live-verification requirement above.

**Dependencies:** U2 (the script should exercise the corrected `parseClientIp`/`checkRateLimit` behavior, including the new 400 policy).

**Files:**
- `scripts/verify-rate-limit.ts` — new

**Approach:** Mirror `scripts/e2e-tailor-cv.ts`'s shape (header comment with usage, `dotenv/config` import, graceful skip-and-exit-0 when credentials are absent, PASS/FAIL console output, non-zero exit on failure). Import `checkRateLimit` and `getRateLimitConfig` directly from `app/api/lib/rate-limit.ts` rather than driving the full HTTP pipeline — this isolates real-Redis rate-limit behavior from LLM/knowledge-base setup the user may not have configured. Use a unique identifier per run (e.g. `smoke-${Date.now()}`) so repeated runs don't collide with a stale bucket from a prior run still inside its window.

**Technical design (directional):**
```
if UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing:
  print "skipping — no Upstash credentials"; exit 0

config = getRateLimitConfig()
identifier = "smoke-" + Date.now()

for i in 1..config.maxRequests:
  result = checkRateLimit("smoke-script", identifier)
  assert result.allowed === true; report PASS/FAIL per request

blocked = checkRateLimit("smoke-script", identifier)
assert blocked.allowed === false
assert blocked.remaining === 0
assert blocked.resetTime > now

print summary; exit 0 if all assertions held, else exit 1
```

**Patterns to follow:** `scripts/e2e-tailor-cv.ts` for structure, console output style, and the credential-presence skip pattern; `tests/helpers/rate-limit-mock.ts`'s `RatelimitResponse` shape for what fields to check on the result.

**Test scenarios:** This is a manual verification script rather than a `node:test` unit — its own body is the test. It must assert, against the real Upstash instance:
- The first `maxRequests` calls for a fresh identifier all report `allowed: true` with strictly decreasing `remaining`.
- The next call for the same identifier reports `allowed: false`, `remaining: 0`, and a `resetTime` in the future.
- Credentials absent → script prints a clear skip message and exits `0` (does not fail CI or block on missing secrets).
- Any unexpected thrown error (e.g. Upstash unreachable, bad credentials) is caught, printed clearly, and exits non-zero rather than throwing an unhandled rejection.

**Verification:** With real credentials configured, running `npx tsx scripts/verify-rate-limit.ts` prints a PASS summary and exits `0`. Without credentials, it exits `0` with a skip message (safe to leave in the repo without breaking anything that might invoke it).

---

## Scope Boundaries

**In scope:** the two build-breaking type errors, `parseClientIp`'s redesign and the unknown-IP reject policy, closing `todos/000`, and the live smoke-test script.

**Out of scope / explicitly not touched:**
- `x-real-ip` support — removed along with `TRUSTED_PROXIES` rather than kept as a parallel path; revisit only if Railway is confirmed to set it and `x-forwarded-for` proves insufficient.
- Per-user/session-based rate limiting — `_sessionId` remains reserved for future auth integration, unchanged.
- Any change to the sliding-window algorithm, `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`/`RATE_LIMIT_TIMEOUT_MS` defaults, or the Redis key prefix.

### Deferred to Follow-Up Work

- Automated CI coverage of the live smoke-test script (e.g. running it in a staging pipeline with real credentials) — out of scope until the user has verified it manually.

---

## Risks & Dependencies

- **Assumption on Railway's proxy behavior:** the rightmost-XFF-entry trust model assumes Railway's edge either overwrites `x-forwarded-for` or appends to it (both make the rightmost entry trustworthy). If Railway's actual networking ever changes (e.g. an additional CDN is placed in front), the "rightmost = Railway's own edge" assumption should be re-validated.
- **Behavior change, not just a bug fix:** requests with no resolvable IP now get `400` instead of being silently rate-limited under `"unknown"`. Any caller (the CCC consumer app) that wasn't setting `x-forwarded-for` will start seeing `400`s where it previously got `200`/`429`s sharing the global bucket — worth a quick check that the consumer app's request path always goes through a proxy that sets this header.
- **`.env` is user-managed and gitignored** — this plan only updates `.env.example`; the user adds real `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` to their local `.env` separately before running U3's script.

---

## Sources & Research

- `tsc --noEmit` and `npm run build` output (this session) — confirmed both defects directly.
- Next.js v15 upgrade guide and [PR #68379](https://github.com/vercel/next.js/pull/68379) ("breaking: remove `geo` and `ip` from `NextRequest`") — confirmed `.ip` removal and the lack of a framework-level, hosting-agnostic replacement.
- `docs/solutions/upstash-redis-rate-limit-migration.md` — migration history, prior review findings, and the original (now superseded) assumption that `cause` propagation already worked.
- `todos/000-pending-p1-resolve-unknown-ip-global-bucket.md` — the deferred fast-follow item this plan closes.
- `docs/arch/README.md` — confirmed Railway deployment (no Vercel, no Edge Functions), ruling out `@vercel/functions`.
