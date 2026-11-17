# Workflow Quick Reference

Human-in-the-loop TDD workflow. All work happens on feature branches — never on `main`.

| | Branch rule |
|---|---|
| **Always** | `feature/<slug>` (create before step 3) |
| **During build** | No commits — working tree accumulates |
| **Review** | Local uncommitted diff (`/5-review-local`) |
| **Git** | `/6-commit` → semantic commits + push → CodeRabbit on PR |

**Out of scope for this workflow:** typo/CSS/markdown-only tweaks — do those in a normal chat without the artifact pipeline.

---

## Git Safety (always-active rule)

Before any code modification or git write operation:
1. `git branch --show-current`
2. If `main` → `git checkout -b feature/<slug>` first
3. **Never** commit, push, or write files on `main`

---

## The 7-step sequence

| Step | Command | Mode | Model | When |
|------|---------|------|-------|------|
| 0 (opt) | `/0-pair-programmer` | Ask | DeepSeek V4 Pro / Gemini 3.1 Pro Flex | Design unclear |
| 1 | `/1-task-definition` | Agent | DeepSeek V4 Pro | Task bounded; writes `CURRENT_PLAN.md` |
| 2 | `/2-decomposition` | **Plan** | Auto / DeepSeek V4 Pro | After step 1; Cursor plan + task metadata |
| — | **Create branch** | — | — | `git checkout -b feature/<slug>` before step 3 |
| 3 | `/3-test` | Agent (**Auto**) | Auto | Per task: full test suite only |
| — | **You run tests** | — | — | Confirm failure (right reason) |
| 4 | `/4-implement` | Agent (**Auto**) | Auto | Per task: implementation; loop until green |
| — | **You confirm pass** | — | — | Tell agent tests passed → `Status: Done` |
| 5 | `/5-review-local` | Agent | DeepSeek V4 Pro | All tasks `Done`; reviews working tree |
| 5a (opt) | `/5a-review-validate` | Ask | Gemini / Sonnet | Critical or low-confidence findings |
| 6 | `/6-commit` | Agent | Auto | Semantic commits; push + PR |
| — | **CodeRabbit** | — | — | After push; wait before merge |
| 7 (opt) | `/7-reflection` | Agent | DeepSeek V4 Flash | Hard session or post-merge |

### Model-diverse variant

| Step | Model change |
|------|----------------|
| 2 | **Gemini 3.1 Pro Flex** — independent decomposition |
| 5 | **Gemini 3.1 Pro Flex** — independent local review |
| 5a, 7 | **Sonnet latest** — validation + reflection |

---

## Per-task TDD loop (steps 3–4)

Repeat for each task in `CURRENT_PLAN.md` until all show `Status: Done`.

```
/3-test     → agent writes FULL test suite for this task
            → agent emits: Tests: [paths]. Run: [command]
YOU         → run command; confirm tests FAIL (assertion/import errors, not typos)

/4-implement → paste failure output OR implement from contract
            → agent writes production code only
            → agent emits: Run: [command]
YOU         → run command
            → still failing? re-invoke /4-implement with new output
            → all green? tell agent "tests passed" → Status: Done

Review Checkpoint: Yes → pause for human check before next task's /3-test
```

**No git during steps 3–4.** All changes stay uncommitted until `/6-commit`.

---

## Decision gates

**Before step 3:** on feature branch, not `main`.

**During step 4:** do not start the next task until current task is `Status: Done`.

**Before step 5:** all tasks `Status: Done`; tests green locally.

**Before step 6:** resolve Critical findings in `REVIEW_NOTES.md` (use `/5a-review-validate` if needed).

**Before merge:** `/6-commit` pushed; CodeRabbit complete; findings resolved.

---

## Session start checklist

1. `git branch --show-current` → if `main`, create `feature/<slug>`.
2. Read `CURRENT_PLAN.md` — session date current?
3. Read `OPEN_QUESTIONS.md` — no unresolved `## Blocking` items.
4. Run `/3-test` for first `Status: Pending` task.

---

## If something goes wrong

| Situation | Action |
|-----------|--------|
| On `main` at session start | `git checkout -b feature/<slug>` immediately |
| Stale plan | Confirm session date or discard and re-run `/1-task-definition` |
| Blocker in OPEN_QUESTIONS | Resolve; **delete** text under `## Blocking` (don't leave "resolved" notes) |
| Tests pass at step 3 unexpectedly | Fix tests with `/3-test` — contract too weak |
| Tests fail at step 4 | Re-invoke `/4-implement` with output |
| Need to rework a Done task | Re-run `/2-decomposition` or reset task to `Pending` |
| Review Critical finding | Fix locally, re-run `/5-review-local` |
| Agent committed on main | Should not happen — `gitSafety.mdc` rule prevents this |
| CodeRabbit pending | Wait after `/6-commit` push before merge |

---

## Artifacts

| File | Written by | Read by |
|------|-----------|---------|
| `CURRENT_PLAN.md` | 1, 2, 4 (`Status: Done`) | 2–7 |
| `OPEN_QUESTIONS.md` | 1, 2, 3, 4 | 1–4, 6 |
| `REVIEW_NOTES.md` | 5, 5a | 5a, 6, 7 |
| `ARCHITECTURE.md` | You, 4 | 1–5 |
| `ENGINEERING_LEARNINGS.md` | 7 | 3, 4 (optional) |

Index **only** `ARCHITECTURE.md` in Cursor Docs. Session files go stale if indexed.

---

## File layout

```
.cursor/
  rules/gitSafety.mdc
  rules/agentRules.mdc
  commands/
    0-pair-programmer-ds.md
    1-task-definition-ds.md
    2-decomposition-ds.md
    3-test-ds.md
    4-implement-ds.md
    5-review-local-ds.md
    5a-review-validate-ds.md
    6-commit-ds.md
    7-reflection-ds.md
  artifacts/
    CURRENT_PLAN.md
    OPEN_QUESTIONS.md
    REVIEW_NOTES.md
    ARCHITECTURE.md
    ENGINEERING_LEARNINGS.md
```

Coordination files exist **only** under `.cursor/artifacts/`.

---

## Model tiers

| Tier | Models | Steps |
|------|--------|-------|
| Auto | Cursor Auto | 3, 4, 6 |
| Exploration | DeepSeek V4 Pro | 0, 1, 2, 5 |
| Validation | Gemini 3.1 Pro Flex | 2, 5 (diverse); 5a |
| Convergence | Sonnet / Opus | 5a, 7 |

See `testing-notes.md` for routing notes.
