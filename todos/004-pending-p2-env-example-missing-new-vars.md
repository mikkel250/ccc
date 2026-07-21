---
status: done
priority: p2
issue_id: 004
tags: [code-review, standards, config]
dependencies: []
---

# New Environment Variables Not Fully Documented in `.env.example`

## Acceptance Criteria

- [x] Every new JSON-curator `getEnv*` consumer appears in `.env.example`
- [x] Entries include purpose and default comments
- [x] Auth, size limits, dual rate limits, smoke mins, Langfuse curator cache TTL documented
- [x] No repeat audit scheduled — `.env.example` remains the canonical catalog

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-07-20 | Created | project-standards-reviewer |
| 2026-07-20 | Done | Expanded `.env.example` + API.md table; added `LANGFUSE_CURATOR_PROMPT_CACHE_TTL_SECONDS` |
