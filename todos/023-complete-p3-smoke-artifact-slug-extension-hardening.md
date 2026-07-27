---
status: complete
priority: p3
issue_id: "023"
tags:
  - code-review
  - security
  - hardening
dependencies: []
---

# Smoke Artifact Slug: Minor Hardening Opportunities

## Problem Statement

Security review of `smokeArtifactSlug()` identified two low-risk hardening opportunities. Neither is exploitable given the current call chain (`basename()` always strips directory separators before sanitization), but they represent defense-in-depth gaps.

## Findings

### 1. Extension stripping only handles `.md` / `.MD`

```typescript
const base = basename(jdPath).replace(/\.md$/i, "");
```

If a file named `exploit.md.docx` is passed, `.replace(/\.md$/i, "")` strips `.md` → `exploit.docx`, then the slug becomes `exploit.docx` and the artifact becomes `exploit.docx.docx` (double extension). Node's `writeFileSync` handles this fine, but it's non-obvious behavior.

**Severity:** P3 — cosmetic, no security impact.

### 2. No explicit null byte guard

The regex `/[^a-zA-Z0-9._-]+/g` doesn't match `\x00`. If a null byte somehow survived `basename()` (it can't — Node's path module treats it as path terminator), it would pass through to `join()` and potentially truncate the path in C-level filesystem calls.

**Severity:** P3 — defense-in-depth, not exploitable through current call chain. `basename()` normalizes null bytes.

## Proposed Solutions

### Option A: Leave as-is

Both issues are defense-in-depth. The current implementation is safe through its call chain.

**Pros:** No unnecessary code.
**Cons:** None meaningful.
**Effort:** None.
**Risk:** None.

### Option B: Add explicit null byte filter (belt-and-suspenders)

```typescript
const safe = base.replace(/\x00/g, "");
```

**Pros:** Hardens against theoretical future misuse.
**Cons:** YAGNI — solves a problem that doesn't exist in the call chain.
**Effort:** Trivial.
**Risk:** None.

### Option C: Strip ALL extensions, not just `.md`

```typescript
const base = basename(jdPath).replace(/\.[^.]+$/i, "");
```

**Pros:** Cleaner slug for any file extension.
**Cons:** Changes behavior — `wayfare-mgr.md` → `wayfare-mgr` (same), but `notes.backup.md` → `notes.backup` instead of `notes`. Could be surprising.
**Effort:** Trivial.
**Risk:** Low — test coverage catches regressions.

## Technical Details

- **Affected files:** `app/api/lib/smoke-helpers.ts` (line 61)
- **Affected components:** `smokeArtifactSlug`
- **Database changes:** None

## Acceptance Criteria

- [x] Hardened terminal extension stripping; no null-byte change needed because the existing negated allowlist already removes null bytes.
- [x] Added a `source.docx` regression test proving generated output is `source.docx`, not `source.docx.docx`.
- [x] Existing tests pass.

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-07-27 | Finding discovered during PR #17 security review | `basename()` provides strong enough protection; these are belt-and-suspenders |
| 2025-07-27 | Completed | Strip a terminal extension generically; verified the existing allowlist replaces null bytes. |

## Resources

- PR: #17 (`feature/smoke-jd-named-artifacts`)
- File: `app/api/lib/smoke-helpers.ts` (lines 60-67)
- Security review: security-sentinel subagent
