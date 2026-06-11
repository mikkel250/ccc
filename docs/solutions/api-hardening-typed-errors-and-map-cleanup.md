---
tags: [migrated, api, errors, rate-limiting, memory, hardening]
created: 2026-06-06
source: docs/archive/engineering-learnings.md
---

# API Hardening: Typed Errors and Map Cleanup

## Problem
Multiple hardening patterns converged in one sweep: catch-block `message.includes(...)` routing, per-IP promise-chain maps without paired cleanup, and wide fixture blast radius from type-only changes (`parseFailed: boolean`).

## Solution
- Replace catch-block `message.includes(...)` routing with typed errors (`RateLimitError`, `ServiceError`) at the library throw site; the route maps `instanceof` once to HTTP status
- When introducing auxiliary Maps for concurrency control, design idle pruning in the same task as the primary state map — local review flagged growth only after serialization landed
- Prune paired module-level Maps together when one holds authoritative bucket state and the other holds derived async state (`requestLog` + `ipChains`)
- Enumerate mock-fixture counts in decomposition so test migration is scoped before implementation, not discovered mid-review
- A 15-task hardening sweep splits cleanly by layer (errors → route/KB → rate limit → eval signaling → config) — semantic commits, no painful re-split

## See Also
- [Original source](docs/archive/engineering-learnings.md)
