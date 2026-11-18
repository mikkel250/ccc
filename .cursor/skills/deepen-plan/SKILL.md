---
name: deepen-plan
description: Stress-test an existing implementation plan and selectively strengthen weak sections with targeted research. Use when a plan needs more confidence around decisions, sequencing, system-wide impact, risks, or verification. Best for Standard or Deep plans, or high-risk topics such as auth, payments, migrations, external APIs, and security. For structural or clarity improvements, prefer document-review instead.
argument-hint: "[path to plan file]"
---

# Deepen Plan

**Note: The current year is 2026.** Use this when searching for recent documentation and best practices.

`/workflows-plan` does the first planning pass. `deepen-plan` is a second-pass confidence check.

Use this skill when the plan already exists and the question is not "Is this document clear?" but rather "Is this plan grounded enough for the complexity and risk involved?"

This skill does **not** turn plans into implementation scripts. It identifies weak sections, runs targeted research only for those sections, and strengthens the plan in place.

`document-review` and `deepen-plan` are different:
- Use the `document-review` skill when the document needs clarity, simplification, completeness, or scope control
- Use `deepen-plan` when the document is structurally sound but still needs stronger rationale, sequencing, risk treatment, or system-wide thinking

## Interaction Method

Use the `ask_user_question` tool when available. Ask one question at a time. Prefer a concise single-select choice when natural options exist.

## Plan File

<plan_path> #$ARGUMENTS </plan_path>

If the plan path above is empty:
1. Check `docs/plans/` for recent files
2. Ask the user which plan to deepen

Do not proceed until you have a valid plan file path.

## Core Principles

1. **Stress-test, do not inflate** - Deepening should increase justified confidence, not make the plan longer for its own sake.
2. **Selective depth only** - Focus on the weakest 2-5 sections rather than enriching everything.
3. **Preserve the planning boundary** - No implementation code, no git command choreography, no exact test command recipes.
4. **Use artifact-contained evidence** - Work from the written plan, its `Context & Research`, `Sources & References`, and its origin document when present.
5. **Respect product boundaries** - Do not invent new product requirements. If deepening reveals a product-level gap, surface it as an open question or route back to `/workflows-brainstorm`.
6. **Prioritize risk and cross-cutting impact** - The more dangerous or interconnected the work, the more valuable another planning pass becomes.

## Workflow

### Phase 0: Load the Plan and Decide Whether Deepening Is Warranted

Read the plan file completely. If the plan frontmatter includes an `origin:` path, read the origin document too.

Classify plan depth:
- **Lightweight** - small, bounded, low ambiguity, usually 2-4 implementation units
- **Standard** - moderate complexity, some technical decisions, usually 3-6 units
- **Deep** - cross-cutting, high-risk, or strategically important work, usually 4-8 units

Build a risk profile. High-risk signals: auth, payments, data migrations, external APIs, privacy/compliance, cross-interface parity, significant rollout concerns.

Decision defaults:
- **Lightweight** plans usually do not need deepening unless high-risk
- **Standard** plans often benefit when important sections look thin
- **Deep** or high-risk plans often benefit from a targeted second pass

If the plan already appears sufficiently grounded, say so briefly and recommend moving to `/workflows-work` or `document-review`.

### Phase 1: Parse the Plan Structure

Map the plan into sections. Look for: Overview, Problem Frame, Requirements Trace, Scope Boundaries, Context & Research, Key Technical Decisions, Open Questions, High-Level Technical Design, Implementation Units, System-Wide Impact, Risks & Dependencies, Sources & References.

If the plan uses different headings, map by intent rather than exact names.

### Phase 2: Score Confidence Gaps

For each section, compute trigger count from the checklists below. Add 1 for high-risk topics where the section is materially relevant. Add 1 for critical sections (Key Technical Decisions, Implementation Units, System-Wide Impact, Risks & Dependencies, Open Questions) in Standard or Deep plans.

Select the top **2-5** sections by score. For lightweight plans, cap at 1-2 unless high-risk.

#### Section Checklists

**Requirements Trace**: vague requirements, missing success criteria, units don't advance requirements, origin requirements not carried forward.

**Context & Research / Sources & References**: cited patterns never used in decisions, learnings don't shape the plan, high-risk work lacks grounding, research is generic.

**Key Technical Decisions**: decisions without rationale, rationale without tradeoffs, no connection to scope/requirements, obvious design fork never addressed.

**Open Questions**: product blockers hidden as assumptions, planning questions deferred to implementation, resolved questions lack basis in repo context or research.

**High-Level Technical Design** (when present): wrong medium for the work, contains implementation code instead of pseudo-code, doesn't connect to key decisions or implementation units.

**Implementation Units**: unclear dependency order, missing file/test paths, units too large or too vague, approach notes are thin.

**System-Wide Impact**: affected interfaces/callbacks/middleware missing, failure propagation underexplored, state/data integrity risks absent.

**Risks & Dependencies**: risks without mitigation, rollout/monitoring implications missing, external dependency assumptions weak.

### Phase 3: Select Targeted Research Agents

For each selected section, choose 1-3 agents. Maximum ~8 agents total.

Use the `subagent` tool with these skill names:

**Requirements Trace / Open Questions**:
- `spec-flow-analyzer` — missing user flows, edge cases, handoff gaps
- `repo-research-analyst` — repo-grounded patterns, conventions

**Context & Research / Sources & References**:
- `learnings-researcher` — institutional knowledge in `docs/solutions/`
- `framework-docs-researcher` — official framework/library behavior
- `best-practices-researcher` — current external patterns

**Key Technical Decisions**:
- `architecture-strategist` — design integrity, boundaries, tradeoffs
- Add `framework-docs-researcher` or `best-practices-researcher` when external grounding is needed

**High-Level Technical Design**:
- `architecture-strategist` — validating the design accurately represents the approach
- `repo-research-analyst` — grounding in existing repo patterns

**Implementation Units / Verification**:
- `repo-research-analyst` — concrete file targets, patterns to follow
- `pattern-recognition-specialist` — consistency, duplication risks

**System-Wide Impact**:
- `architecture-strategist` — cross-boundary effects, interface surfaces
- Match risk: `performance-oracle`, `security-sentinel`, or `data-integrity-guardian`

**Risks & Dependencies**:
- Match risk: `security-sentinel` (auth/security), `data-integrity-guardian` (data safety), `data-migration-expert` (migrations), `deployment-verification-agent` (rollout), `performance-oracle` (capacity/latency)

For each agent, pass: a short plan summary, the exact section text, why it was selected (which triggers fired), the plan depth/risk profile, and a specific question. Instruct agents to return findings that change planning quality — no implementation code, no shell commands.

### Phase 4: Run Targeted Research

Launch selected agents in parallel using the `subagent` tool with `tasks` array. If the selected section set is small, read agent outputs inline. If large enough that inline returns would bloat context, use a scratch directory under `.context/compound-engineering/deepen-plan/<run-id>/` and have agents write compact artifact files.

### Phase 5: Synthesize and Rewrite the Plan

Strengthen only the selected sections. Keep the plan coherent.

Allowed changes: clarify decision rationale, tighten requirements trace, reorder/split implementation units, add missing pattern references or file/test paths, expand system-wide impact/risks/rollout treatment, reclassify open questions, add `deepened: YYYY-MM-DD` to frontmatter.

Do **not**: add implementation code, add git commands, rewrite the entire plan, invent new product requirements without surfacing them as open questions.

### Phase 6: Write and Offer Next Steps

Update the plan file in place. Present next steps:

1. **View diff** - Show what changed
2. **Run document-review** - Improve the updated plan
3. **Start /workflows-work** - Begin implementing
4. **Deepen specific sections further** - Another targeted pass

If no substantive changes were warranted, say the plan is already sufficiently grounded.

NEVER CODE! Research, challenge, and strengthen the plan.
