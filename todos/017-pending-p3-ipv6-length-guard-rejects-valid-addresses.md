---
status: done
priority: p3
issue_id: "017"
tags: [code-review, networking, edge-case]
dependencies: []
---

# `isValidIp` 45-char length guard may reject valid IPv6 addresses with zone IDs

## Problem Statement

`app/api/tailor-cv/route.ts:isValidIp()` applies a 45-character guard before calling Node's `isIP()`:

```typescript
function isValidIp(value: string): boolean {
  if (value.length > 45) return false;
  return isIP(value) !== 0;
}
```

The longest standard IPv6 representation is 39 characters (8 groups of 4 hex digits, 7 colons). However, IPv6 addresses with zone IDs (e.g., `fe80::1%eth0`) or IPv4-mapped notation (`::ffff:192.0.2.128`) can reach ~55 characters. These are valid per RFC 4007 and Node's `isIP()` accepts them — but the 45-char guard rejects them prematurely.

## Findings

- **File:** `app/api/tailor-cv/route.ts:27-30` — `isValidIp()` length guard
- **RFC 4007 zone IDs** can add `%` + interface name to IPv6 addresses
- **IPv4-mapped IPv6** notation (e.g., `::ffff:192.0.2.128` = 21 chars, well within limit)
- **Longest practical:** `fe80:0000:0000:0000:0000:0000:0000:0001%eth0` = ~46 chars — just over the limit
- **Impact:** Extremely rare in practice; most proxy chains use standard IPv6 without zone IDs

## Proposed Solutions

### Option A: Increase length guard to 55
- **Effort:** Trivial
- **Risk:** None
- **Pros:** Covers all valid IPv6 + zone ID cases; no performance impact
- **Cons:** None meaningful

### Option B: Remove length guard, rely on `isIP()` alone
- **Effort:** Trivial
- **Risk:** Very low (DoS via 10MB XFF header handled by `MAX_XFF_ENTRIES` cap)
- **Pros:** Simplest code; no arbitrary limit
- **Cons:** Slightly more work per entry for absurdly long invalid strings (mitigated by 5-entry cap)

### Option C: Keep as-is
- **Effort:** None
- **Risk:** None
- **Pros:** No code change
- **Cons:** Theoretically rejects valid IPv6 + zone ID addresses behind proxies that use zone IDs in XFF (vanishingly rare)

## Technical Details

- **Affected files:** `app/api/tailor-cv/route.ts`
- **Components:** IP parsing
- **Database changes:** None

## Acceptance Criteria

- [x] Decision: increased guard to 55 (Option A) — covers IPv6 with zone IDs
- [x] All route tests pass
- [x] `isIP()` still called with untruncated value

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-22 | Created from code review | security-sentinel |
| 2026-07-22 | Resolved — increased to 55 | `isValidIp` length guard changed from 45 → 55 to accommodate IPv6 + zone ID addresses per RFC 4007. |

## Resources

- File: `app/api/tailor-cv/route.ts`
- Tests: `tests/route.test.ts`
