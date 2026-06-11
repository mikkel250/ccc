---
tags: [migrated, prompts, configuration, langfuse]
created: 2026-05-26
source: docs/archive/engineering-learnings.md
---

# Dual Prompt Sources: Unify Placeholder Formats First

## Problem
A Langfuse-hosted prompt and its hardcoded fallback used different placeholder conventions (`{{CONTEXT}}` vs `{CONTEXT}`). The substitution function needed two sequential `.replace()` calls, creating fragility where knowledge base content containing those literal strings would be corrupted.

## Solution
Before writing the first substitution function, pick one placeholder format and apply it to both sources (Langfuse prompt template and fallback text). Unify configuration-side, not code-side. Dual-source configuration means format-lock the contract before writing resolution logic.

## See Also
- [Original source](docs/archive/engineering-learnings.md)
