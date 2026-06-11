---
tags: [migrated, eval, testing, fixtures, prompts]
created: 2026-06-04
source: docs/archive/engineering-learnings.md
---

# Two-Stage Eval Pipeline: Plan Correction Before Implementation

## Problem
Assuming test JDs should carry YAML frontmatter with structured headings — production JDs are raw unstructured recruiter text. Also assuming single-pass judging was sufficient when structured extraction before judging improved precision enough to warrant the extra LLM call.

## Solution
- Test fixtures should match production input format from day one — YAML frontmatter on test JDs caused churn in test contracts and pipeline code that was entirely avoidable
- When a config mapping is bounded by a TypeScript union type, add a `warnUnmapped*()` runtime function for any key not in the map — prevents silent fallback violating cross-provider constraints
- Derive env-var defaults from a single canonical config source — eliminated source-of-truth splits between modules

## See Also
- [Original source](docs/archive/engineering-learnings.md)
