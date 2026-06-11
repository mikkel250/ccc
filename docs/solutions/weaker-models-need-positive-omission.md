---
tags: [migrated, prompts, llm, hallucination, weaker-models]
created: 2026-05-26
source: docs/archive/engineering-learnings.md
---

# Weaker Models Need Positive Omission Instructions

## Problem
Negative instructions ("do not hallucinate", "never invent") are less effective than positive constraints for weaker models. The model is left with only a prohibition and no alternative action.

## Solution
Pair every "do not invent X" with a "if absent, omit Y" alternative. Example: "If the provided background lacks information for any field, leave it blank" gives the model a concrete alternative action. The weakest model in the evaluation set (Gemini 3.1 Flash Lite) benefits most from near-zero temperature (0.0) and maximal constraint specificity.

## See Also
- [Original source](docs/archive/engineering-learnings.md)
