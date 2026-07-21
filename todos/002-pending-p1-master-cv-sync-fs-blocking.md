---
status: done
priority: p1
issue_id: 002
tags: [code-review, performance, architecture]
dependencies: []
---

# Sync Filesystem Operations in Master CV Loading Blocks Event Loop

## Acceptance Criteria

- [x] No synchronous filesystem calls in the HTTP request handler path (`requireMasterCv` cache-only)
- [x] Master CV preloaded asynchronously at startup (`preloadMasterCv` from `instrumentation.ts`)
- [x] All existing tests pass
- [x] `MASTER_CV_JSON` (env body) path continues to work

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | performance-oracle |
| 2026-07-20 | Partial | Module-level cache still synced on first `loadMasterCv` |
| 2026-07-20 | Done | Async `preloadMasterCv` + request-path cache-only `requireMasterCv` |
