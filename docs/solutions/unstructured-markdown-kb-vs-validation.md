---
tags: [migrated, knowledge-base, llm, parsing]
created: 2026-05-25
source: docs/archive/engineering-learnings.md
---

# Unstructured Markdown KB vs Validation Strictness

## Problem
Injecting the entire raw Markdown knowledge base (50-60k tokens) into the LLM prompt simplifies architecture but shifts the entire burden of enforcing structural formatting onto the prompt itself. Unpredictable LLM outputs (nested tables, alternate header syntax) will break parsers.

## Solution
- Accept latency and cost in v1 in exchange for retaining maximum context without complex chunking logic
- Move asynchronous tasks to batch APIs over time to reduce cost
- Write highly rigid prompt skeletons when bridging between LLM text generation and programmatic parsers like `docx`
- The prompt must strictly prescribe output format to mitigate parser crashes

## See Also
- [Original source](docs/archive/engineering-learnings.md)
