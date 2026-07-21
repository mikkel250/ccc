---
status: ready
priority: p1
issue_id: 001
tags: [code-review, security, auth]
dependencies: []
---

# R5d Startup Bypass Fatal Gate Missing

## Problem Statement

Plan requirement R5d mandates: *"Startup must fatal if the bypass flag is set while any production marker is present."* The current implementation checks the bypass+gating per-request in `authenticateTailorRequest()`, but does **not** fatal at startup (module init / top-level). This means a misconfigured production deploy with `TAILOR_AUTH_INSECURE_BYPASS=true` would fail-closed per-request (correct behavior observed in review) but would not proactively crash the process — it would silently serve 503s instead of hard-failing with a clear startup message that operators can't miss.

## Findings

- **Location:** `app/api/lib/tailor-auth.ts` — no startup fatal check
- **Evidence:** The `authenticateTailorRequest()` function guards every request correctly, but R5d explicitly says "startup must fatal." A per-request 503 is less visible than a crash-loop during deploy.
- **Current behavior:** If `TAILOR_AUTH_INSECURE_BYPASS=true` on Railway production, the process starts but every tailor request returns 503 "Service unavailable."
- **Expected per R5d:** The process should `process.exit(1)` or throw during module init so the deploy visibly fails.

## Proposed Solutions

1. **Add startup guard in `tailor-auth.ts` top-level:** Check `isProductionLikeDeploy() && isTailorAuthBypassRequested()` at module load and `process.exit(1)` with a clear message.
   - Pros: Meets R5d exactly; operators see crash-loop on misconfiguration
   - Cons: Module-level side effect; must be careful with test env
   - Effort: Small
   - Risk: Low

2. **Add startup guard in a separate init module:** Export an `assertSafeStartup()` function, call it in `route.ts` top-level or a server init hook.
   - Pros: Cleaner separation; testable
   - Cons: Slightly more indirection
   - Effort: Small
   - Risk: Low

## Recommended Action

(Leave blank — to be filled during triage)

## Technical Details

- **Affected files:** `app/api/lib/tailor-auth.ts`
- **Affected components:** Auth module, startup path
- **No database changes**
- **No API changes**

## Acceptance Criteria

- [ ] Process exits with non-zero code when `TAILOR_AUTH_INSECURE_BYPASS=true` AND `NODE_ENV=production` or `RAILWAY_ENVIRONMENT=production`
- [ ] Process starts normally when bypass is set in local/dev
- [ ] Test env is not affected (tests don't trigger startup fatal)
- [ ] Clear error message logged before exit

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | Found by security-sentinel + project-standards-reviewer |
| 2026-07-20 | Implemented | Added `assertSecureStartup()` in tailor-auth.ts with module-level fatal, test-mode no-op |

## Resources

- Plan: `docs/plans/2026-07-20-001-feat-json-curator-cv-pipeline-plan.md` (R5d)
- Source: `app/api/lib/tailor-auth.ts`
