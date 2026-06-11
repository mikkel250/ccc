---
tags: [migrated, eval, config, env-vars, code-review]
created: 2026-06-05
source: docs/archive/engineering-learnings.md
---

# Eval Judge Prompts: Env Config Retrofit

## Problem
Treating LLM judge rubric strings as fixed code constants broke the repo rule that every tunable parameter must come from `process.env`. Local review caught architecture drift; post-merge CodeRabbit caught config-policy drift — neither pass alone covered both layers.

## Solution
- Define judge/extraction prompts with `getEnvString(name, default)` in the same commit as the prompt, and add commented placeholders to `.env.example` — avoids a second review/commit cycle
- Prompt strings in `app/api/lib/` are configuration, not prose: wrap at export time, not after external review
- Check `.env.example` parity before pushing even on single-file CodeRabbit follow-ups

## See Also
- [Original source](docs/archive/engineering-learnings.md)
