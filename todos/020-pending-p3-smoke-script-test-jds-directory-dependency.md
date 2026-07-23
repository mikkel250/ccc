---
status: done
priority: p3
issue_id: "020"
tags: [code-review, dx, agent-native, scripting]
dependencies: []
---

# Smoke script requires pre-existing `knowledge-base/test-jds/` directory

## Problem Statement

`scripts/e2e-tailor-cv.ts` reads test job descriptions from `knowledge-base/test-jds/` on disk. If that directory doesn't exist (fresh clone, tree restructure), the smoke script fails with a filesystem error rather than accepting a JD path argument or inline JD text. Minor DX friction for agent invocation.

## Findings

- **File:** `scripts/e2e-tailor-cv.ts`
- **Issue:** Hard dependency on a directory that isn't guaranteed to exist
- **Agent-native impact:** Agents must know about and create the directory before invoking smoke

## Proposed Solutions

### Option A: Accept `--jd` CLI argument as alternative to directory scan
- **Effort:** Small
- **Risk:** None
- **Approach:** Add `--jd <path>` or `--jd-text <string>` CLI flag; fall back to directory scan if no flag

### Option B: Add graceful error when directory is missing
- **Effort:** Trivial
- **Risk:** None
- **Approach:** Check `fs.existsSync()` before scanning; print helpful message: "No test-jds/ directory found. Provide --jd <file> or create knowledge-base/test-jds/"

## Technical Details

- **Affected files:** `scripts/e2e-tailor-cv.ts`
- **Components:** CLI scripting
- **Database changes:** None

## Acceptance Criteria

- [x] Smoke script fails with helpful message when test-jds/ is missing (shows expected dir path + usage hint)
- [x] Existing `jdPath` positional argument already serves as `--jd` alternative

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-22 | Created from code review | agent-native-reviewer |
| 2026-07-22 | Resolved — graceful error | Wrapped `readdirSync` in try/catch; on ENOENT, throws with path + usage hint. The existing positional JD path arg (`npm run smoke -- <baseUrl> <jdPath>`) already provides the `--jd` alternative. |

## Resources

- File: `scripts/e2e-tailor-cv.ts`
