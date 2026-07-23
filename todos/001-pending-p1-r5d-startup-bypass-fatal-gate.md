---
status: done
priority: p1
issue_id: 001
tags: [code-review, security, auth]
dependencies: []
---

# R5d Startup Bypass Fatal Gate Missing

## Acceptance Criteria

- [x] Process exits with non-zero code when `TAILOR_AUTH_INSECURE_BYPASS=true` AND production-like deploy
- [x] Process starts normally when bypass is set in local/dev
- [x] Test env is not affected (`NODE_ENV=test` no-op)
- [x] Clear error message logged before exit
- [x] Guard invoked from server entrypoint (`instrumentation.ts` → `ensureSecureStartup`), not module load

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | security-sentinel + project-standards-reviewer |
| 2026-07-20 | Implemented | `assertSecureStartup` + later moved to `ensureSecureStartup` via instrumentation |
