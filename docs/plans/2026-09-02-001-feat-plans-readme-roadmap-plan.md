---
title: "Plans README Roadmap - Plan"
date: 2026-09-02
type: feat
topic: plans-readme-roadmap
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
status: shipped
---

> **Shipped** (`docs/plans/README.md` + AGENTS session-start). First-pass pivot / live-API-judge milestone table is superseded by the 2026-09-05 README reconcile against `STRATEGY.md` (no in-progress plan; judges retired).

# Plans README Roadmap - Plan

## Goal Capsule

**Objective:** Add `docs/plans/README.md` as the ordered north-star for reaching a working personal pivot job-search tool, and wire `AGENTS.md` so both the operator and CE agents read it before the active implementation plan.

**Product authority:** This Product Contract. `STRATEGY.md` remains product thesis; this artifact owns build sequence and progress tracking only.

**Open blockers:** None.

**Product Contract preservation:** unchanged — planning resolves R8 milestone reconciliation and deferred STRATEGY-track placement below.

---

## Product Contract

### Summary

Create `docs/plans/README.md` as an ordered milestone board inside the CE plans folder: status, what each step unblocks, links to per-milestone plans, and one named **active** milestone at the top. Update `AGENTS.md` session-start guidance to read the README first, then the linked active plan — replacing "most recent plan" as the default north-star.

### Problem Frame

CCC already has product direction in `STRATEGY.md` and nine feature plans in `docs/plans/`, but no single view ties them into build order or progress. The operator tracks via `STRATEGY.md` plus whichever plan is newest, which fails when deciding what to work on next. Agents inherit the same gap: `AGENTS.md` sends them to the most recent plan file, not the milestone that matters for finishing the personal pivot tool.

### Key Decisions

- **North-star lives in `docs/plans/README.md`, not a root `ROADMAP.md`.** `(session-settled: user-directed — chosen over root ROADMAP.md: stays inside CE's plan home for vibecoding workflow alignment)` Governs R1, R2, R3.
- **Finish line is the personal pivot tool, not full product vision.** Governs R4, R5.
- **`STRATEGY.md` stays product thesis; README owns sequence and status.** Governs R1, R6.
- **Session start reads README first, then the active linked plan.** `(session-settled: user-directed — chosen over manual @-reference only: agents need the same north-star as the operator)` Governs R7.
- **Progress is manually updated when milestones move; no auto-sync from git.** Governs R9.

### Requirements

**North-star artifact**

- R1. `docs/plans/README.md` exists and is the canonical ordered milestone board for build progress toward the personal pivot tool finish line (per R4).
- R2. The README opens with one clearly labeled **Active milestone** — the single milestone `/ce-work` and session start should target until the operator changes it.
- R3. Below the active milestone, the README lists ordered milestones. Each entry includes: short outcome-oriented name, status (`done` / `in progress` / `not started`), what it unblocks, and a link to an existing `docs/plans/` plan or an explicit `needs plan` marker.
- R4. Milestones are outcome-oriented toward "personal pivot job-search tool works well" (e.g., flexible mode produces submit-worthy pivot CVs), not a flat archive of past plan filenames.
- R5. Milestones cover the path to the personal pivot tool only; full product vision items (frontend, multi-user, learning system) appear at most as deferred backlog notes, not active milestones.

**Relationship to existing docs**

- R6. `STRATEGY.md` is not duplicated or replaced; README may reference STRATEGY tracks for context but owns build order and status.
- R7. `AGENTS.md` Context Discipline table and stale-plan guidance are updated so session/task start reads `docs/plans/README.md` first for the active milestone, then the linked implementation plan — not the most recent plan by filename date alone.

**Maintenance**

- R8. First README pass reconciles existing plans in `docs/plans/` against milestones (mark done / in progress / not started; link or note gaps).
- R9. Milestone status is updated manually when work completes or focus shifts; no requirement for automated status derivation.

### Key Flows

- F1. Operator or agent starts a session
  - **Trigger:** New CCC work session or `/ce-work` without an explicit plan path.
  - **Actors:** Operator, CE agent.
  - **Steps:** Read `docs/plans/README.md` → identify active milestone → open linked plan (or run `/ce-plan` if `needs plan`) → execute.
  - **Covered by:** R2, R7.

- F2. Milestone completes
  - **Trigger:** Implementation plan acceptance criteria met and validated (e.g., smoke pass where applicable).
  - **Actors:** Operator (may delegate update to agent on request).
  - **Steps:** Mark milestone `done` in README → set next milestone to `in progress` and update **Active milestone** → link or create its plan if missing.
  - **Covered by:** R2, R3, R9.

- F3. New work needs a plan
  - **Trigger:** Active milestone shows `needs plan`.
  - **Actors:** Operator, CE agent.
  - **Steps:** Run `/ce-brainstorm` or `/ce-plan` as usual → write plan under `docs/plans/` → update README link and status.
  - **Covered by:** R3, R8.

### Acceptance Examples

- AE1. Session start with README present
  - **Covers R7.**
  - **Given:** `docs/plans/README.md` names "Flexible pivot posture" as active and links to `docs/plans/2026-07-27-feat-flexible-curation-posture-and-critique-loop-plan.md`.
  - **When:** An agent follows `AGENTS.md` session-start guidance.
  - **Then:** It reads the README first and opens the linked plan — not whichever plan has the newest date prefix.

- AE2. Active milestone is unambiguous
  - **Covers R2.**
  - **Given:** README lists five milestones with mixed status.
  - **When:** Operator asks "what should I work on next?"
  - **Then:** The **Active milestone** section alone answers without inferring from dates or file order.

- AE3. Completed work is visible
  - **Covers R3, R8.**
  - **Given:** JSON curator pipeline is shipped and its plan exists.
  - **When:** Operator opens README.
  - **Then:** That milestone shows `done`, links to its plan, and states what downstream milestone it unblocks.

### Scope Boundaries

**Deferred for later**

- Automated milestone status from git merges or CI.
- `AGENTS.md` hook telling `/ce-work` to parse README programmatically beyond read-first guidance.
- Full product roadmap (frontend, multi-user, learning system) as active milestones.

**Outside this product's identity**

- Replacing the CE loop (`/ce-brainstorm` → `/ce-plan` → `/ce-work` → `/ce-compound`).
- Turning README into a second `STRATEGY.md` with product thesis content.

### Dependencies / Assumptions

- Compound Engineering workflow remains the primary planning path; README sits above it.
- Existing plans in `docs/plans/` remain protected artifacts; README indexes them rather than replacing them.
- `STRATEGY.md` tracks remain the source for *what matters*; README tracks *what to build next*.

### Outstanding Questions

None — milestone reconciliation resolved in Planning Contract (KTD2).

### Sources / Research

- `STRATEGY.md` — product tracks and finish-line signals for flexible/pivot path.
- `AGENTS.md` — current `docs/plans/` conventions and "most recent plan" session-start rule.
- Existing plans under `docs/plans/` — reconciliation inputs for R8.
- `docs/plans/2026-07-23-refactor-extract-entrypoint-complexity-plan.md` — U3 smoke-runner status on `feature/smoke-runner-extract`.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **README format: fixed sections, markdown table for milestones.** Rationale: scannable for humans and agents; no custom tooling. Sections: `## Active milestone`, `## Milestones (build order)`, `## Backlog (STRATEGY tracks, not active)`, `## How to update`. Governs U1.
- KTD2. **First-pass milestone reconciliation (personal pivot finish line).** Ordered milestones and initial status based on repo state (2026-09-02):

  | # | Milestone | Status | Plan | Unblocks |
  |---|-----------|--------|------|----------|
  | M1 | JSON curator API returns curated JSON + `.docx` | done | `docs/plans/2026-07-20-001-feat-json-curator-cv-pipeline-plan.md` | Smoke + flexible curation |
  | M2 | MVP auth + rate limiting | done | `docs/plans/2026-06-12-feat-upstash-redis-rate-limit-plan.md`, `docs/plans/2026-07-04-001-fix-rate-limit-client-ip-resolution-plan.md` | Safe operator/product traffic |
  | M3 | Flexible pivot curation posture + critique loop | in progress | `docs/plans/2026-07-27-feat-flexible-curation-posture-and-critique-loop-plan.md` | Submit-worthy pivot CVs |
  | M4 | Smoke runner modular + live-API judges | in progress | `docs/plans/2026-07-23-refactor-extract-entrypoint-complexity-plan.md` (U3), `docs/plans/2026-07-28-feat-smoke-cover-letter-docx-plan.md` | Operator quality loop |
  | M5 | Tenure honesty guardrails | not started | needs plan | Credibility floor for pivot CVs |
  | M6 | Holistic "strong enough" smoke judge | not started | needs plan (STRATEGY judge coverage) | Pivot success signal |
  | M7 | Cross-model parity matrix | not started | needs plan | Production confidence across providers |

  **Active milestone (initial):** M4 — matches current branch `feature/smoke-runner-extract` and in-flight smoke extraction work.

  **Backlog (not active milestones):** Judge model bakeoff (`docs/plans/2026-07-30-001-feat-judge-model-bakeoff-plan.md` — requirements-only, parked until smoke modularization lands per that plan's R6); code-quality hardening and review-todo plans (maintenance, not pivot-critical path).

  Governs R8, U1.

- KTD3. **AGENTS.md changes are surgical.** Update the Context Discipline table row for session start and add one bullet under stale-plan guidance: if README active milestone disagrees with newest plan date, README wins. Do not rewrite the full Documentation Map. Governs U2.

- KTD4. **Cross-file contract test for README plan links.** One targeted test parses linked plan paths from README and asserts each file exists — catches broken links without testing prose. Governs U3. Exception justified per AGENTS.md cross-file invariant rule.

### Assumptions

- M3 and M4 can both show `in progress`; **Active milestone** still names exactly one focus (M4 initially).
- Operator will manually flip active milestone when focus shifts; no automation in v1.

### Sequencing

1. U1 — draft README with KTD2 content.
2. U2 — wire AGENTS.md to README-first.
3. U3 — add link-integrity test; run suite.

---

## Implementation Units

### U1. Create `docs/plans/README.md`

**Goal:** Deliver R1–R5, R8 via KTD1–KTD2.

**Files:** `docs/plans/README.md` (new).

**Patterns:** Match tone/structure of `docs/arch/README.md` index style — short purpose line, then structured lists. Link plans with repo-relative paths. Use `STRATEGY.md` track names in backlog section only.

**Content checklist:**

- Opening paragraph: finish line = personal pivot tool; README is north-star above individual plans.
- **Active milestone** block: name, one-line outcome, status, linked plan(s), why it's active.
- Milestone table or numbered list per KTD2 (all fields from R3).
- **Backlog** section for bakeoff, frontend, multi-user, learning system.
- **How to update** (3–4 bullets): mark done, set next active, link new plans, do not duplicate STRATEGY thesis.

**Test scenarios:**

- Manual: open README — active milestone answers "what next?" without reading plan filenames.
- Manual: every `done` milestone links to a plan that exists on disk.

**Verification:** U3 automated link check; manual AE2 walkthrough.

**Depends on:** nothing.

**Covers:** R1, R2, R3, R4, R5, R6, R8, R9.

---

### U2. Wire `AGENTS.md` session-start to README

**Goal:** Deliver R7 via KTD3.

**Files:** `AGENTS.md` (Context Discipline section ~lines 98–111).

**Changes:**

- Replace table row "Session / task start | Most recent plan…" with: read `docs/plans/README.md` first → then the active milestone's linked plan.
- Amend stale-plan check: newest plan date is a staleness *signal* only; README **Active milestone** is authoritative for what to work on.
- Add one line in Documentation Map bullet for `docs/plans/`: README is the milestone index; individual plans are implementation detail.

**Patterns:** Existing table format in Context Discipline; no new sections.

**Test scenarios:**

- Manual AE1: grep `AGENTS.md` confirms README-first ordering in session-start row.
- Manual: agent reading AGENTS.md would not default to date-sorted plan pick.

**Verification:** `npm test` (full suite unchanged); manual grep/read.

**Depends on:** U1 (README must exist before agents are pointed at it).

**Covers:** R7.

---

### U3. README plan-link integrity test

**Goal:** Guard KTD4 cross-file invariant.

**Files:** `tests/plans-readme.test.ts` (new).

**Behavior:**

- Skip gracefully if `docs/plans/README.md` missing (red phase before U1).
- Parse markdown links targeting `docs/plans/*.md` (exclude this plan file if self-linked).
- Assert each path exists via `fs.existsSync`.
- Assert README contains substring `Active milestone`.

**Patterns:** Follow `tests/eval-architecture-docs.test.ts` style for doc invariant tests if present; otherwise minimal `node:test` + `node:assert/strict`.

**Test scenarios:**

- README exists with valid links → pass.
- Broken link injected → fail with path in assertion message.

**Verification:** `npm test -- tests/plans-readme.test.ts`.

**Depends on:** U1.

**Covers:** R3 (link integrity aspect), AE3 indirectly.

---

## Verification Contract

| Command | Applies to | Purpose |
|---------|------------|---------|
| `npm test -- tests/plans-readme.test.ts` | U3 | Link integrity + Active milestone presence |
| `npm test` | all | No regressions |
| `npm run lint` | all | AGENTS.md / README edits don't break lint if applicable |

Manual verification after U1+U2:

- Open `docs/plans/README.md` — confirm active = M4, statuses match KTD2.
- Read `AGENTS.md` Context Discipline table — confirm README-first (AE1).

---

## Definition of Done

**Global:**

- `docs/plans/README.md` exists with Active milestone, ordered milestones, backlog, and update instructions (R1–R6, R8).
- `AGENTS.md` session-start reads README before linked plan (R7, AE1).
- `tests/plans-readme.test.ts` passes.
- `npm test` and `npm run lint` pass.
- No STRATEGY.md duplication; no automated status sync added (scope boundaries honored).

**Per unit:**

- **U1 done:** README matches KTD2 table; operator can answer "what's next?" from Active milestone alone.
- **U2 done:** AGENTS.md table and stale-plan note updated; Documentation Map mentions README index.
- **U3 done:** Test fails on broken plan link; passes on current README.
