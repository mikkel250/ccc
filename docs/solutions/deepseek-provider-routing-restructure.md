---
tags: [migrated, llm, providers, routing, review]
created: 2026-06-02
source: docs/archive/engineering-learnings.md
---

# DeepSeek Integration: Provider Routing Restructure

## Problem
Review tooling produced false-positives from incomplete trace of short conditional chains. `gh pr create` failed on 401 even when `git push` succeeded.

## Solution
- OpenRouter-as-default (all unrecognized models → `openrouter`) is safer than provider-specific fallbacks — eliminates silent misrouting when model names drift
- Mark tasks with "Review Checkpoint: Yes" only on the single task with highest blast radius (routing/auth boundary changes)
- Commit-per-task granularity is sufficient for everything else
- Verify GitHub CLI auth (`gh auth status`) in pre-commit checklist; document manual PR URL as the expected fallback path

## See Also
- [Original source](docs/archive/engineering-learnings.md)
