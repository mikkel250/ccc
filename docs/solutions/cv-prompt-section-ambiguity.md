---
tags: [migrated, prompts, llm, output-structure]
created: 2026-05-26
source: docs/archive/engineering-learnings.md
---

# CV Prompt: Section Ambiguity Between Similar Output Sections

## Problem
Two similarly-named sections ("Relevant Accomplishments" and "Measurable Accomplishments") with overlapping purposes caused content duplication in weaker models.

## Solution
When a prompt defines two output sections that could be confused, add a mutual cross-reference explicitly stating they must not overlap. Example: "These highlights synthesize across roles and differ from the per-role metric bullets in Measurable Accomplishments below. Do not duplicate content between the two sections." Test each section pair for collision by looking at what a weaker model (not the strongest) produces — the collision may only surface there.

## See Also
- [Original source](docs/archive/engineering-learnings.md)
