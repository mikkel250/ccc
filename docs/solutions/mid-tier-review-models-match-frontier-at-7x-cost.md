# Mid-Tier Review Models Match Frontier at 7x Cost

**Date:** July 2026  
**Context:** Controlled experiment comparing 15 models on identical code review prompts (testing + standards review of a 2,283-line TypeScript diff). Cost data from OpenRouter billing.

## Key Finding

**Models in the $0.30–$1.00 range match $6–$8 frontier models on code review quality.** Kimi K3 at $0.93 found both the same blocker (type error) and P1 regression (revise prompt omits first draft) as Sonnet 5 at $6.38 — a 7x cost gap for identical outcomes.

## Cost-Quality Rankings

### Precision (catches subtle logic/contract bugs)

| Model | Cost | Unique P0/P1 Found |
|-------|:---:|------|
| `openrouter/anthropic/claude-sonnet-latest` | $6.38 | Type error (ran `next build`) + revise-prompt bug |
| `openrouter/moonshotai/kimi-latest:max` | $0.93 | Same two findings — identical output at 1/7th cost |
| `openrouter/openai/gpt-5.4` | $8.05 | Revise-prompt bug (unique among GPT models) |
| `openrouter/z-ai/glm-5.1:max` | $0.33 | Revise-prompt bug — independently found at 1/20th cost |
| `openrouter/x-ai/grok-latest:max` | $0.46 | Revise-prompt bug — independently found |

### Breadth (catches edge cases, patterns, assertion gaps)

| Model | Cost | Testing Findings | Unique Strength |
|-------|:---:|:---:|------|
| `openrouter/minimax/minimax-m3:max` | $0.14 | 20 | Highest volume of any model tested |
| `deepseek/deepseek-v4-pro` | $0.65 | 13 | Most thorough edge-case coverage (env cleanup, score ranges, null handling) |
| `openrouter/z-ai/glm-5.1:max` | $0.33 | 12 | Good precision + breadth balance |

### Do Not Use for Review

| Model | Cost | Why |
|-------|:---:|-----|
| `openrouter/openai/gpt-5.4-mini` | $0.018 | 4 surface findings, missed every behavioral issue |
| `openrouter/moonshotai/kimi-k2.7-code` | $0.59 | Zero findings — code-specific variant worse than general |
| `openrouter/anthropic/claude-opus-latest` | $12.00 | Failed on credit limits; 31% of total experiment budget for nothing |

### Total Experiment Cost

| Model | Total |
|-------|------|
| Claude Opus 5 | $12.00 (31%) |
| Claude Sonnet 5 | $6.38 (17%) |
| GPT-5.4 | $8.05 (21%) |
| GPT-5.6 Terra | $2.67 (7%) |
| Kimi K3 | $0.93 (2.4%) |
| DeepSeek V4 Pro | $1.08 (2.8%) |
| All others combined | ~$7.00 (18%) |

**Total: ~$38.40 across 15 models.** The three frontier models (Opus, Sonnet, GPT-5.4) consumed 69% of the budget but delivered no additional unique findings beyond what the $0.30–$1.00 tier found independently.

## Practical Recommendations

1. **Default review combo ($2.14):** Kimi-latest:max (precision) + DeepSeek v4-pro (breadth) + GLM-5.1:max or Grok-latest:max (tiebreaker)
2. **Never auto-select frontier models** — they're 4–20x the cost with marginal quality gains
3. **Distribute mid-tier reviewers across different models** — model diversity catches more bugs than model loyalty (no single model found all 28 issues)
4. **Always use `:max` thinking on non-frontier models** — cost is negligible, quality improvement is pronounced
5. **Reserve Sonnet/GPT-5.x** for auth/crypto/payments/data-migration diffs where false negatives are catastrophic

## References

- Experiment run in Pi session, July 2026
- Findings documented in global AGENTS.md for cross-project reuse
- OpenRouter billing data from https://openrouter.ai/settings/usage
