---
status: complete
priority: p2
issue_id: "022"
tags:
  - code-review
  - architecture
  - smoke
dependencies: []
---

# Smoke Artifact Slug Collision Risk (Basename-Only Derivation)

## Problem Statement

`smokeArtifactSlug()` derives the artifact slug solely from `basename(jdPath)`. Two JD files in different directories with the same basename (e.g., `knowledge-base/test-jds/smoke/wayfare-mgr.md` vs `legacy-jds/wayfare-mgr.md`) produce identical slugs and overwrite each other's artifacts.

**Severity:** P2 because today's workflow has only one JD source directory, but the function signature accepts arbitrary paths. The collision surface will grow as smoke is run against eval corpora or legacy JDs.

## Findings

1. **`smokeArtifactSlug` (line 60-67 of `app/api/lib/smoke-helpers.ts`)** reduces any path to its basename:

```typescript
export function smokeArtifactSlug(jdPath: string): string {
  const base = basename(jdPath).replace(/\.md$/i, "");
  const slug = base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "jd";
}
```

2. **Current risk is theoretical** — the `defaultJdPath()` only reads from `knowledge-base/test-jds/`, and `smoke/` is the only subdirectory. But nothing in the API prevents `--` / `process.argv[2]` from being any path.

3. **The collision is silent** — artifacts are silently overwritten without warning.

## Proposed Solutions

### Option A: Include parent directory in slug (conservative)

If the JD is in a subdirectory of `test-jds/`, prefix the slug with the relative directory:

```
smoke/wayfare-mgr.md → "smoke-wayfare-mgr"
headlands.md (top-level) → "headlands"
```

**Pros:** Maintains backward compatibility for top-level JDs, prevents subdirectory collisions.
**Cons:** Requires knowledge of the test-jds root, coupling.
**Effort:** Small.
**Risk:** Low.

### Option B: Accept slug collision as working-as-designed

Document that JD basenames must be unique across all smoke input sources. If a collision occurs, the second run overwrites the first.

**Pros:** No code change, simplest mental model.
**Cons:** Silent data loss, fragile as smoke usage grows.
**Effort:** None.
**Risk:** Medium — future bugs from overwritten artifacts.

### Option C: Warn on overwrite in `writeArtifacts`

Check if the artifact file already exists before writing and log a warning.

**Pros:** Makes collisions visible without preventing them.
**Cons:** Doesn't prevent the problem, just makes it observable.
**Effort:** Small.
**Risk:** Low.

## Technical Details

- **Affected files:** `app/api/lib/smoke-helpers.ts` (lines 60-75)
- **Affected components:** Smoke artifact naming, `writeArtifacts` in `scripts/e2e-tailor-cv.ts`
- **Database changes:** None
- **Migration required:** None

## Acceptance Criteria

- [x] Selected Option C: warn before a basename collision overwrites existing artifacts.
- [x] `writeArtifacts` checks the two artifact paths and warns before overwrite.
- [x] Docs updated in `docs/test/TESTING.md`.

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-07-27 | Finding discovered during PR #17 review | `basename()`-only slug derivation risks collision across directory boundaries |
| 2025-07-27 | Completed | Retained the documented basename convention and added an explicit overwrite warning. |

## Resources

- PR: #17 (`feature/smoke-jd-named-artifacts`)
- File: `app/api/lib/smoke-helpers.ts`
- File: `scripts/e2e-tailor-cv.ts`
