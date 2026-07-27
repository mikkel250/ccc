---
status: complete
priority: p1
issue_id: "021"
tags:
  - code-review
  - testing
  - regression
dependencies: []
---

# Test JD Validation Suite Misses `smoke/` Subdirectory

## Problem Statement

`tests/test-jds.test.ts` → `listTestJdFiles()` uses `readdirSync(TEST_JDS_DIR)` **without `{ recursive: true }`**, so it only enumerates top-level `.md` files. PR #17 moved `wayfare-mgr.md` into `knowledge-base/test-jds/smoke/` and added `headlands.md` there. Both files are now invisible to the validation suite.

**Impact:** A silent coverage regression. `wayfare-mgr.md` was previously validated for PII, content structure, YAML frontmatter, and kebab-case naming — it no longer is. `headlands.md` (73 lines of recruiter text with emails, phone numbers, compensation details) was never validated against PII or content rules.

## Findings

1. **`listTestJdFiles()` is non-recursive** (`tests/test-jds.test.ts:31-34`):

```typescript
function listTestJdFiles(): string[] {
  if (!fs.existsSync(TEST_JDS_DIR)) return [];
  return fs
    .readdirSync(TEST_JDS_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(TEST_JDS_DIR, name));
}
```

2. **`headlands.md` has never been validated** — it was added in this PR and contains recruiter-email text that should pass PII checks, but we don't know for certain without the suite running on it.

3. **Count assertions didn't catch this** — the top-level still has 4 `.md` files (`frontend-developer.md`, `full-stack-engineer.md`, `platform-sre.md`, `staff-engineering-manager.md`), so `>= 2` and `>= 3` assertions still pass.

## Proposed Solutions

### Option A: Make `listTestJdFiles` recursive (recommended)

```typescript
function listTestJdFiles(): string[] {
  if (!fs.existsSync(TEST_JDS_DIR)) return [];
  const result: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) result.push(full);
    }
  }
  walk(TEST_JDS_DIR);
  return result;
}
```

**Pros:** Full coverage for subdirectories, negligible complexity, follows existing pattern (the test already walks lists, just not directories).
**Cons:** None.
**Effort:** Small.
**Risk:** Low — only affects test code.

### Option B: `readdirSync` with `{ recursive: true }`

```typescript
function listTestJdFiles(): string[] {
  if (!fs.existsSync(TEST_JDS_DIR)) return [];
  return fs
    .readdirSync(TEST_JDS_DIR, { recursive: true })
    .filter((name) => typeof name === "string" && name.endsWith(".md"))
    .map((name) => path.join(TEST_JDS_DIR, name));
}
```

**Pros:** One-liner, uses Node built-in.
**Cons:** `recursive: true` returns mixed `string | Dirent | Buffer` types depending on options; needs type narrowing. Slightly less readable than the explicit walk.
**Effort:** Small.
**Risk:** Low.

## Technical Details

- **Affected files:** `tests/test-jds.test.ts` (line 31-34)
- **Affected components:** Test JD validation suite
- **Database changes:** None
- **Migration required:** None

## Acceptance Criteria

- [x] `listTestJdFiles()` returns files from subdirectories of `test-jds/`
- [x] `headlands.md` is validated for PII (email, phone, SSN patterns)
- [x] `headlands.md` is validated for YAML frontmatter absence
- [x] `headlands.md` is validated for readable content
- [x] `headlands.md` filename slug is kebab-case
- [x] `wayfare-mgr.md` is validated again
- [x] All existing tests still pass
- [x] Count assertions were already valid; recursive discovery raises the corpus count to six.

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-07-27 | Finding discovered during PR #17 review | Moving test JDs to subdirectories silently drops them from validation |
| 2025-07-27 | Completed | Added explicit nested-JD regression assertions and recursive `Dirent` walk; full suite passes. |

## Resources

- PR: #17 (`feature/smoke-jd-named-artifacts`)
- File: `tests/test-jds.test.ts`
- File: `knowledge-base/test-jds/smoke/headlands.md`
- File: `knowledge-base/test-jds/smoke/wayfare-mgr.md`
