---
tags: [migrated, llm, providers, deepseek, integration]
created: 2026-06-03
source: docs/archive/engineering-learnings.md
---

# DeepSeek: OpenAI-Compatible API as Zero-Code Integration

## Problem
Adding a new LLM provider could require new SDK code, a new dispatch function, and routing changes.

## Solution
Check OpenAI API compatibility first — DeepSeek required zero new SDK code beyond a different `baseURL` and `apiKey` wired into the existing `OpenAI` client. Centralize provider detection in exactly one function (`detectProvider`) — the entire routing restructure touched only that function plus the new wrapper; `dispatchProvider` and all callers were untouched.

## See Also
- [Original source](docs/archive/engineering-learnings.md)
