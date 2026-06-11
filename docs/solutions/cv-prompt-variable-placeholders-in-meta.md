---
tags: [migrated, prompts, templates, llm]
created: 2026-05-26
source: docs/archive/engineering-learnings.md
---

# CV Prompt: Variable Placeholders in Meta-Instructions Create Semantic Noise

## Problem
The `compileCvPrompt` function substituted `{CONTEXT}` everywhere in the prompt, including meta-instruction lines like "Before each claim, verify it appears in {CONTEXT}". After compilation, these became "Before each claim, verify it appears in [huge KB text dump]" — syntactically confusing for models parsing instructions literally.

## Solution
Use plain text ("the provided background") in instructional/meta lines, reserving `{CONTEXT}` only where the KB content must be data-injected. Template variables should go where data must be interpolated, not where the concept is referenced in metalanguage. After designing a template, compile it and read it aloud — mangled natural language will be obvious.

## See Also
- [Original source](docs/archive/engineering-learnings.md)
