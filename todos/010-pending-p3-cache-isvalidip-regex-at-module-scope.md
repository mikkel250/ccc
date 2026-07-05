---
status: pending
priority: p3
issue_id: "010"
tags: [code-review, performance, micro-optimization]
dependencies: []
---

# Cache `isValidIp` regexes at module scope

## Problem Statement

`isValidIp()` in `app/api/tailor-cv/route.ts` defines two regex literals (`ipv4Regex`, `ipv6Regex`) inside the function body. Every call to `parseClientIp` — once per request — recompiles both regexes. Moving them to module-level constants avoids per-request compilation overhead.

## Findings

- **Performance Oracle:** "The regex and array allocations are cosmetic concerns at this endpoint's expected throughput."
- **Project Standards Reviewer:** "Every literal value is a future outage" — regex literals inside hot functions are the regex equivalent of inline string literals.

## Proposed Solutions

### Option A: Hoist to module-level constants (Recommended)

```typescript
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

function isValidIp(value: string): boolean {
  if (value.length > 45) return false;
  return IPV4_REGEX.test(value) || IPV6_REGEX.test(value);
}
```

**Pros:** Zero per-request allocation; follows existing convention (`TRUSTED_PROXIES` was module-level before removal).
**Cons:** None.
**Effort:** Trivial
**Risk:** None

### Option B: Do nothing

**Pros:** No code change.
**Cons:** Minor per-request overhead.
**Effort:** None
**Risk:** None

## Technical Details

- **Affected files:** `app/api/tailor-cv/route.ts`
- **No database changes**

## Acceptance Criteria

- [ ] `ipv4Regex` and `ipv6Regex` are `const` at module scope
- [ ] `isValidIp` still functions identically
- [ ] `npm test` passes

## Work Log

### 2026-07-04 — Finding created

**By:** Multi-agent code review (performance-oracle, project-standards-reviewer)

**Actions:** None yet.

## Resources

- PR branch: `feature/rate-limit-unknown-ip-fastfollow`
