---
name: run-me-first
model: gemini/gemini-3.1-pro-flex
description: >-
  One-shot project bootstrapping. Pase with stack details to produce a rules file
  and populated ARCHITECTURE.md. Recommended model: Gemini 3.1 Pro Flex for
  better structured output and inference of conventions from sparse input.
  DeepSeek V4 Pro is a solid alternative if you prefer a single-model workflow.
---

# Project Setup Prompt

> Paste this into a new Cursor Plan mode chat.
> Provide your stack, project purpose, and known constraints below.
> The output will be a customized **project rules** file (no stack duplication) and a populated **`.cursor/artifacts/ARCHITECTURE.md`** (including **Stack context** at the top).

---

## Instructions for the Model

You are helping configure the Guided Mode workflow for a new project.

Read the following project context provided by the engineer, then produce two outputs:

1. A customized **project rules** file (full contents, ready to save as e.g. `rules/agentRules.mdc` or `.cursor/rules/<name>.mdc` with appropriate YAML frontmatter such as `alwaysApply: true`).
2. A populated `.cursor/artifacts/ARCHITECTURE.md` skeleton.

**Important:** Do **not** put stack bullets in the rules file. Stack and repo-wide conventions belong only in `.cursor/artifacts/ARCHITECTURE.md` (see **## Stack context (for agents)** and the **## Stack** table).

### Output 1: Project rules

Start from the repo’s baseline rules (Communication, Scope, Uncertainty, Context Discipline with artifact paths, Review Philosophy). Adjust only if the engineer asks for workflow changes.

Do **not** add a `# Stack Context` section; point agents at `.cursor/artifacts/ARCHITECTURE.md` instead (the baseline already does).

### Output 2: `.cursor/artifacts/ARCHITECTURE.md`

Produce a pre-filled skeleton based on what the engineer provided. Fill **## Stack context (for agents)** and **## Stack** (and related sections) so the following are concrete or marked `[TBD]`:

- Language and version
- Framework and key conventions
- Auth system and where auth logic lives
- Database and ORM, and any raw-query rules
- State management approach
- Test runner and conventions
- Deployment target and any runtime constraints
- Any non-obvious architectural rules the engineer mentions

Infer reasonable conventions from the stack if the engineer doesn't specify (e.g., if they say Next.js App Router, infer server components by default, `use client` only when necessary). Flag inferences explicitly so the engineer can confirm or correct.

---

## Engineer: Fill In Below

**Project purpose (2–3 sentences):**


**Stack:**


**Auth model:**


**Database / storage:**


**Deployment target:**


**Known constraints or non-negotiables:**


**Anything else agents should always know:**


---

## After Running This Prompt

1. Merge or replace your project rules file (e.g. `rules/agentRules.mdc`) with Output 1
2. Copy `commands/` into your `.cursor/` (or symlink if supported) so slash commands are available
3. Replace `.cursor/artifacts/ARCHITECTURE.md` with Output 2
4. Fill in any `[TBD]` sections before your first implementation session
5. Verify model IDs in `config/models.md`
6. You're ready — see `WORKFLOW_QUICKREF.md` for the recommended invocation order