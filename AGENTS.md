# Git Branch Safety

You operate under a locked-down branch policy. The `main` branch is protected at the remote level (PR-only). Your local behavior must align.

## Hard Constraints (Do Not Violate)

- **Never** write files, edit code, or run any git write operation (`commit`, `push`, `merge`, `rebase`) while checked out on `main`.
- **Never** proceed without verifying the active branch when a task involves file writes or git commands.
- If you are on `main` and the task requires code changes, **stop and create a feature branch first**. Do not ask — just do it.

## Required Workflow

```
git branch --show-current → on main?
  → YES: git checkout -b feature/<descriptive-slug>
  → NO:  proceed on current branch
```

All implementation, testing, and review work happens on feature branches exclusively.

## Git Operations Checklist

Before running `git commit`, `git push`, `git merge`, or `git rebase`:
1. Run `git branch --show-current`
2. If output is `main` → abort the operation. Create a feature branch first.

## Push and PR

- Push only feature branches (`git push -u origin HEAD`).
- After pushing, tell the user: "Branch pushed. Open or refresh the PR and wait for CodeRabbit before merging."
- **Never** push `main` directly.

## Wrong / Right

**Wrong:** Writing implementation files directly on `main` and then committing.
**Right:** `git checkout -b feature/my-task` → write files → commit → push → "Open a PR when ready."

**Wrong:** Assume the branch is correct without checking.
**Right:** Run `git branch --show-current` before any git operation or code modification.

# Agent Capability Usage

You are equipped with powerful tools inside Cursor. Use them effectively:

- **Broad Exploration vs Specific Needles**: When searching for patterns across many files, analyzing broad repository structure, or extracting themes from a large codebase, spawn an `explore` subagent (the Task tool with `subagent_type: explore`). Do NOT run iterative `grep` or `find` directly unless you're searching for a specific known symbol. Use the `Read` tool immediately if you already know the file path and it is directly relevant.
- **File reading threshold**: If a task requires reading more than 2 files for discovery or understanding — rather than reading a known target — spawn an `explore` subagent instead of chaining `Read` calls. Sequential speculative reads are slower and consume more context than a single focused explore pass.
- **Parallel tool calls**: When multiple independent reads, searches, or operations are needed in the same step, batch them in a single response. Do not execute them sequentially unless each depends on the result of the previous.
- **No speculative reads**: Do not read a file to find out whether it is relevant. Decide first — using the Context Discipline artifact table, the task description, or an explore pass — then read only files you have determined are needed.
- **Thinking model discipline**: If you are a reasoning or thinking-capable model, use your internal trace to decide which files to read and what tool calls to make *before* executing them. Do not read files as part of your reasoning process. Decide, then act.
- **Agent Skills**: When the user requests tasks like "write rules", "add a statusline hook", or mentions platform specifics like Vercel, Next.js, or shadcn, immediately read any matching Skill file (provided in your prompt context) to get the correct instructions and format. Do not guess platform semantics if a Skill is available.
- **Task Management**: Use the TodoWriter/Task tools directly to persist complex multi-step goals, ensuring you do not lose track of subtasks.
- **Post-execution lint check**: After making code changes, run `ReadLints` on every edited file before declaring the task complete. Fix any errors your changes introduced. Do not pass lint errors to the review agent.
- **Background subagents**: When spawning an `explore` or other subagent whose result is not needed until a later step, run it in the background (`run_in_background: true`). Do not block on work that can proceed in parallel.
- **Modes**: Leverage your ability to `SwitchMode` to 'plan' when architecture decisions need collaborative review before writing code. Use 'agent' when you are ready to write code independently.

# Communication

- Be extremely concise
- Prefer bullets over paragraphs
- Never explain what you're about to do
- Never summarize what you just did
- Maximum 3 prose sentences unless explicitly necessary

# Scope

- Implement ONLY the assigned task
- Do not silently redefine architecture
- Do not silently refactor unrelated areas
- Keep changes tightly bounded to the task
- Preserve existing conventions unless asked to change them

# Uncertainty

**Internal ambiguity** — stop and escalate. If you encounter any of the following, do not guess and do not continue:
- architectural ambiguity
- conflicting constraints
- security or auth uncertainty
- billing or payment logic
- data model ambiguity

Resolve the active slug from `docs/plan/_ACTIVE` (first line), then append your findings and questions to `docs/plan/<slug>/OPEN_QUESTIONS.md` and halt. Never write placeholder entries (e.g. "None", "N/A", "No blockers") — if there is nothing to report, leave the section empty. Downstream hooks treat any text under `## Blocking` as a real blocker.

**External ambiguity** — search before stopping. If uncertainty concerns the behavior of a third-party library, external API, or public spec (e.g., "what does this endpoint return on a 429?"), use web search first. Stop and escalate only if the question remains unresolved after searching.

# Context Discipline

**Declarative paths:** resolve the active slug from `docs/plan/_ACTIVE` (first line). Task coordination files live under `docs/plan/<slug>/` (e.g. `docs/plan/<slug>/README.md`). Stable architecture lives in `docs/arch/ARCHITECTURE.md`. Do not search the repo root or other folders for legacy `.cursor/artifacts/` basenames; if a required file is missing, create it under the correct `docs/` path or stop and record the gap in `docs/plan/<slug>/OPEN_QUESTIONS.md`.

**Before any non-trivial work (planning, implementation, or review):** read, in order, only what you need — do not load the whole tree by default.

**Stale plan check:** after resolving `<slug>` from `docs/plan/_ACTIVE`, when reading `docs/plan/<slug>/README.md`, check the `## Session: YYYY-MM-DD` stamp at the top. If the date does not match today's date, or if no stamp is present, ask the user: "The plan in `docs/plan/<slug>/README.md` is dated [date]. Is this the current session's plan, or should I discard it?" Do not act on a potentially stale plan without confirmation. Do not generate or guess today's date — run `date +%Y-%m-%d` if you need to verify it.

| When | Read (in order) | Purpose |
|------|-----------------|--------|
| Session / task start | `docs/plan/_ACTIVE`, then `docs/plan/<slug>/README.md` | Objective, constraints, acceptance criteria |
| Immediately after | `docs/plan/<slug>/OPEN_QUESTIONS.md` | Blockers; do not proceed past unresolved items without updating this file or stopping |
| Before coding or changing architecture | `docs/arch/ARCHITECTURE.md` | Stack, decisions, invariants |
| When debugging past decisions or incidents | `docs/archive/engineering-learnings.md` | Prior post-mortems and gotchas |
| When producing or merging structured review output | `docs/plan/<slug>/REVIEW_NOTES.md` | Where review findings belong (read if continuing a review thread) |

**Handoffs:** prefer `@docs/plan/...`, `@docs/arch/...`, or `@docs/archive/...` plus **scoped** git context (`git diff`, specific commits, named paths) over long chat transcripts. Do not rely on prior messages for facts that belong in artifacts or the repo.

- **Stack and repo-wide conventions** live only in `docs/arch/ARCHITECTURE.md` (see its *Stack context* section and the tables below it); do not duplicate them in rules.

- Prefer artifact references over long chat history
- Codebase reality overrides conversation history
- If artifacts contradict stale discussion, follow the artifacts

# Workflow subagents

Subagent files in this pack use YAML `name` values: `intake`, `decomposition`, `test`, `implement`, `review-local`, `review-validate`, `commit`, `reflection`.

When running as one of these subagents:

- The whole of this rules file applies (Communication, Scope, Uncertainty, Context Discipline, Review Philosophy). **Do not restate** those policies in chat unless the user asks.
- **Read this artifact set first** (resolve `<slug>` from `docs/plan/_ACTIVE`, then paths under `docs/plan/<slug>/` and `docs/arch/`), then only scoped git or paths the user @-mentions:

| Agent `name` | Read first (`docs/…`) |
|-----------------|------------------------------|
| `intake` | `docs/plan/_ACTIVE`, `docs/plan/<slug>/README.md`, `docs/plan/<slug>/OPEN_QUESTIONS.md`, `docs/arch/ARCHITECTURE.md` |
| `decomposition` | `docs/plan/_ACTIVE`, `docs/plan/<slug>/README.md`, `docs/plan/<slug>/OPEN_QUESTIONS.md`, `docs/arch/ARCHITECTURE.md` |
| `test` | `docs/plan/_ACTIVE`, `docs/plan/<slug>/README.md`, `docs/plan/<slug>/OPEN_QUESTIONS.md`, `docs/arch/ARCHITECTURE.md` |
| `implement` | `docs/plan/_ACTIVE`, `docs/plan/<slug>/README.md`, `docs/plan/<slug>/OPEN_QUESTIONS.md`, `docs/arch/ARCHITECTURE.md` |
| `review-local` | `docs/plan/_ACTIVE`, `docs/plan/<slug>/README.md`, `docs/plan/<slug>/OPEN_QUESTIONS.md`, `docs/plan/<slug>/REVIEW_NOTES.md`, `docs/arch/ARCHITECTURE.md` |
| `review-validate` | `docs/plan/<slug>/REVIEW_NOTES.md`, `docs/plan/<slug>/README.md`, `docs/arch/ARCHITECTURE.md` |
| `commit` | `docs/plan/_ACTIVE`, `docs/plan/<slug>/README.md`, `docs/plan/<slug>/OPEN_QUESTIONS.md` |
| `reflection` | `docs/plan/<slug>/README.md`, `docs/plan/<slug>/REVIEW_NOTES.md` |

- For ambiguity, blocking issues, and when to STOP, follow **# Uncertainty** (including appending to `docs/plan/<slug>/OPEN_QUESTIONS.md`).
- For findings and certainty language, follow **# Review Philosophy**.

# Workflow

Slash commands in `commands/` form an optional but recommended sequence. Invoke each when the corresponding condition is met:

- `/0-pair-programmer` — when you need to think through a design, debug a tricky issue, or rubber-duck before committing to a plan.
- `/1-task-definition` — when the *what* is known and the task is bounded. Writes the Task Definition to `docs/plan/<slug>/README.md`.
- `/2-decomposition` — after agent 1 produces the plan README. Plan mode; writes task plan and Cursor plan steps.
- `/3-test` — per task: writes the **complete** failing test suite. You run tests and verify failure.
- `/4-implement` — per task: writes implementation from failure output; you run tests until green; agent marks `Status: Done` when you confirm pass.
- `/5-review-local` — after all tasks are `Done`. Reviews uncommitted working tree; writes `docs/plan/<slug>/REVIEW_NOTES.md`.
- `/5a-review-validate` — only if step 5 surfaced Critical or Low-Confidence findings.
- `/6-commit` — semantic commits from working tree; push feature branch; then wait for CodeRabbit.
- `/7-reflection` — after painful sessions or post-merge. Appends to `docs/archive/engineering-learnings.md`.

# Review Philosophy

- Optimize for correctness over cleverness
- Flag uncertainty explicitly
- Provide evidence for claims
- Confidence must match actual certainty — do not overstate

### Confidence Level Definitions

- **High:** Code path is deterministic, issue is reproducible, no credible alternative interpretation.
- **Medium:** Issue is likely but an alternative explanation exists, or the traced path has gaps.
- **Low:** Issue is possible but requires assumptions about runtime behavior or external state not visible in the diff.
