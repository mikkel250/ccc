---
status: ready
priority: p1
issue_id: 002
tags: [code-review, performance, architecture]
dependencies: []
---

# Sync Filesystem Operations in Master CV Loading Blocks Event Loop

## Problem Statement

`app/api/lib/master-cv.ts` uses `statSync()` and `readFileSync()` in the `loadFromPath()` function, which is called synchronously within `requireMasterCv()` in the POST handler's request path. These synchronous I/O calls block the Node.js event loop during every tailor request that uses `MASTER_CV_PATH`. In a production environment, this prevents the server from handling concurrent requests or performing other async work (like Redis rate-limit checks) while the filesystem is being read.

## Findings

- **Location:** `app/api/lib/master-cv.ts`, function `loadFromPath()` — calls `statSync(filePath)` and `readFileSync(filePath, "utf8")`
- **Evidence:** The `requireMasterCv()` function is called inline in the POST handler (`route.ts` line ~98: `const masterCv = tailorCvDeps.requireMasterCv()`). Any request with `MASTER_CV_PATH` configured will block.
- **Severity:** P1 because this is in the hot request path and directly violates the Node.js event loop model. Even though the file is small, sync I/O in a server request handler is a well-established anti-pattern.

## Proposed Solutions

1. **Convert to async file reads using `fs/promises`:** Replace `statSync`/`readFileSync` with `await stat()`/`await readFile()`. Make `loadMasterCv()` and `requireMasterCv()` async.
   - Pros: Correct Node.js pattern; no event loop blocking
   - Cons: Requires async propagation through `requireMasterCv()` → `route.ts` handler (already async)
   - Effort: Small
   - Risk: Low

2. **Cache master CV at startup in memory:** Load the master CV once at module init (or first request) and store in a module-level variable. The master is static at runtime per the architecture (knowledge base is read-only).
   - Pros: Zero per-request I/O; fastest possible
   - Cons: Process restart needed to pick up changes (acceptable per constraints doc); `MASTER_CV_PATH` env changes require restart anyway
   - Effort: Small
   - Risk: Low

3. **Do both:** Cache at startup but fall back to async read if cache is empty.
   - Pros: Best of both
   - Cons: More complexity
   - Effort: Small
   - Risk: Low

## Recommended Action

Solution 2 is preferred: cache at startup. The architecture constraints document states the knowledge base is read-only at runtime. Master CV from path does not change without a redeploy/restart.

## Technical Details

- **Affected files:** `app/api/lib/master-cv.ts`, `app/api/tailor-cv/route.ts`, `app/api/lib/tailor-cv-deps.ts`
- **Affected components:** Master CV loading, request handler
- **No database changes**
- **No API changes**

## Acceptance Criteria

- [ ] No synchronous filesystem calls in the request handler path
- [ ] Master CV loaded once (at startup/first request) and cached
- [ ] All existing tests pass
- [ ] MASTER_CV_JSON (env body) path continues to work (no fs involved, just JSON.parse)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created from code review | Found by performance-oracle |
| 2026-07-20 | Implemented | Added module-level cache in master-cv.ts + `__resetMasterCvCacheForTest()` for test suite injection |

## Resources

- Plan: `docs/plans/2026-07-20-001-feat-json-curator-cv-pipeline-plan.md` (R1)
- Source: `app/api/lib/master-cv.ts`
- Architecture: `docs/arch/README.md` — "Knowledge base is read-only at runtime"
