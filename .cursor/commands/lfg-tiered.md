---
description: Autonomous end-to-end run for one issue or request. Plan, build, review, fix, and ship to an open PR on the cheapest model that can do each step. Never merges.
argument-hint: "<issue, bug report, or request> [optional plan path to skip planning]"
---

You are the orchestrator for an unattended run in a Cursor Cloud Agent. Take one request from start to an open PR. Never merge. Never ask the user. Stop only where this command says to.

---

## Operating Rules

- **Never merge.** Never push to `main`.
- **Never ask.** Record blockers, residuals, and limits in the PR body or the final report.
- **Never use `*-fast` slugs** or `sonnet-latest`.
- **Pass the model on every Task call.** Use `subagent_type: generalPurpose`.
- **Stop leaves nothing new pushed.** Anything already pushed stays as it is.

---

## Models

| Slug | Use |
|------|-----|
| `composer-2.5` | Mechanical work: Routine fixes, the re-check, shipping |
| `grok-4.7` (high effort) | Default for judgment work: planning, review, substantive fixes, compound |
| `claude-sonnet-5-5` (high effort) | Approved premium use, listed below |

Sonnet 5.5 at high effort is approved only for:
1. The adversarial reviewer, inside `/ce-code-review-tiered`.
2. Difficult tasks in the plan, inside `ce-work-tiered`.
3. Difficult review fixes that name no specific fix (stage 6).
4. Debugging when the cause is unclear or a cheaper model already failed.
5. A retry one tier up from Grok (stage 6 and the retry rule below).

Nothing else uses Sonnet. If a slug is not in the Task tool's list, stop and report it. Do not substitute another model.

---

## Never-Low List

These changes are never-low. Hold them for merge review:
- Auth or sessions
- Security, including headers
- Rate limits
- Secrets or env
- DB schema or migrations
- Major dependency upgrades
- Deploy
- CI or infra config
- Large changes that span several areas

Low-risk changes are docs, tests, small isolated fixes, and patch or minor dependency bumps.

If the diff touches any never-low item, the PR body starts with a **MERGE GATE: never-low** block that names each item. Judge from the diff. When unsure, flag it.

---

## Retry Rule

If a stage fails, retry it once on the next tier up: `composer-2.5` → `grok-4.7` → `claude-sonnet-5-5`. If the retry also fails, stop that path, file an issue with the failure output (stage 6 explains how), and say so in the PR body or the final report.

---

## Stage 0: Branch and Intake

1. Run `git branch --show-current`. If the result is `main`, run `git checkout -b feature/<descriptive-slug>` before any write.
2. Run `git remote`. With no remote, the run is local-only: make every commit, but skip push, PR create, and CI watch. That is a valid end state, not an error.
3. Classify the request:
   - A plan path is given: skip to stage 2 with that path.
   - A report of failing or wrong behavior: stage 1 (defect route).
   - Any other code change: stage 2 (feature route).
   - No code change requested: answer it with the matching skill, then stop.

---

## Stage 1: Defect Route (`ce-debug`)

1. Run `ce-debug` on `grok-4.7`. Use `composer-2.5` instead when the repro is clear and in one area. Use `claude-sonnet-5-5` only when the cause is unclear or a cheaper model already failed.
2. `ce-debug` reproduces the bug, finds the root cause, and writes a failing test. Then it does one of two things:
   - **Small, contained fix (Routine, one area):** it applies the fix. Skip stages 2 through 4 and go to stage 5.
   - **Anything bigger:** it stops at the diagnosis. Hand its root-cause notes to stage 2 as input.
3. If `ce-debug` finds no safe fix, stop and report why.

---

## Stage 2: Plan (`/ce-plan`)

1. Run `/ce-plan` on `grok-4.7` at high effort. Pass the request, plus any debug notes. Tell it that no one will answer questions, so it proceeds on stated assumptions.
2. Use the plan path it reports writing. Never search the plans directory for a candidate.
3. If `/ce-plan` returns blocked, or writes no plan, stop.

---

## Stage 3: Classify (`ce-plan-classify`)

Run `ce-plan-classify` on `grok-4.7` with the explicit plan path. Every implementation unit must get `Complexity: Routine`, `Complex`, or `Difficult`.

---

## Stage 4: Build (`ce-work-tiered`)

1. Run `ce-work-tiered` with the explicit plan path. It routes each task to a subagent on its tier's model:
   - Routine → `composer-2.5`
   - Complex → `grok-4.7` (high)
   - Difficult → `claude-sonnet-5-5` (high)
2. Tasks it marks Blocked do not stop the run. Carry them into the PR body and file one issue per blocked task (stage 6 explains how).
3. If every task is Blocked, stop and report.

---

## Stage 5: Simplify (`ce-simplify-code`)

Run `ce-simplify-code` on the changed code, on `grok-4.7`.

---

## Stage 6: Review, Dedupe, and Fix

### 6a. Review

Run `/ce-code-review-tiered` on `grok-4.7` at high effort, with findings only. Every finding must have severity (P0–P3), a `specific_fix` value (yes or no), and a `fix_complexity` value (Routine, Complex, or Difficult). The adversarial reviewer runs as its own Sonnet subagent, per that command.

### 6b. Dedupe

No separate synthesis command runs. `/ce-code-review-tiered` already dedupes. Check that every finding has all three fields. If `specific_fix` is no and `fix_complexity` is Routine, raise it to Complex. Never lower a tier.

### 6c. Choose Fixes

- **Always fix** P0 and P1.
- **Fix P2 and P3** only when `fix_complexity` is Routine.
- **Everything else:** file a GitHub issue with `gh issue create`. Use the title, severity, file and line, why it matters, evidence, and suggested fix. Note the branch in the body. If `gh` is unavailable, list the finding in the PR body under residuals and say so.

### 6d. Route Each Fix

| `fix_complexity` | `specific_fix` | Model |
|------------------|----------------|-------|
| Routine | yes | `composer-2.5` |
| Complex | yes or no | `grok-4.7` (high) |
| Difficult | yes | `grok-4.7` (high) |
| Difficult | no | `claude-sonnet-5-5` (high) |
| Routine | no | `grok-4.7` (high), as a fallback. Stage 6b should already have raised it to Complex. |

### 6e. Fix Passes

Group the fixes by model. Run one Task subagent per model, in this order, and only for models that have fixes: `composer-2.5`, then `grok-4.7`, then `claude-sonnet-5-5`. Run them one at a time, because they share one working tree. Each subagent gets all its fixes in one brief:
- The finding text verbatim: title, file, line, evidence, why it matters, and suggested fix.
- A first step: confirm each finding holds in the code. A finding that does not hold is reported as rejected, with evidence.
- Implement only the validated fix, with the smallest robust change. Add or update a regression test when practical. Do not broaden scope. Do not commit.
- Report one line per finding: FIXED, REJECTED (with evidence), or NOT FIXED (with reason).

After each pass, run `npm run lint`, `npm run typecheck`, and `npm test`. If the tests fail, retry that pass's fixes once on the next tier up. If that retry also fails, file an issue for each unfixed finding.

### 6f. Re-check

Do not re-run the full review. If a P0 or P1 fix changed more than 10 lines, run one `composer-2.5` subagent on that pass's diff. It checks only for new defects introduced by the fix. Any new finding becomes an issue. Do not loop.

---

## Stage 7: Compound (`ce-compound`)

Run `ce-compound` on `grok-4.7` in non-interactive mode, if the run produced reasoning that the code, tests, and plan do not already capture. If nothing is worth keeping, skip this stage.

---

## Stage 8: Ship (`ce-commit-push-pr`)

1. Confirm the branch is not `main`. Run `git branch --show-current` to check.
2. If there is no remote, make the commit and stop there. Record the local-only state in the report.
3. Run `ce-commit-push-pr` on `composer-2.5`, non-interactively, as `mikkel250`.
4. The PR body includes, in this order:
   - The MERGE GATE block, if any never-low item was touched.
   - A summary of the change.
   - **Fixed in stage 6:** each fix with its severity, file, and model.
   - **Filed as issues:** each issue as a markdown link, with the reason it was not fixed.
   - **Models by stage:** which model ran each stage.
   - **Blocked tasks** from the build, and any residual risk.
   - **Coverage limits:** adversarial not run, `gh` unavailable, or anything else skipped.

---

## Stage 9: Hand Off

Do not watch CI or the PR. Do not send follow-ups. Output a final report:
- The PR URL, or the local-only state.
- The branch name.
- Any MERGE GATE items.
- The issues filed.
- The models used.
- `Branch pushed. Open or refresh the PR and wait for CodeRabbit before merging.`

Merging is out of scope for this command.

---

## Stop Conditions

Stop and report, without pushing anything new, when:
- Planning is blocked or writes no plan (stage 2).
- `ce-debug` finds no safe fix (stage 1).
- Every build task is Blocked (stage 4).
- A stage fails on Sonnet, the top tier (retry rule).
- A slug is not in the Task tool's list (models).

---

## Wrong / Right

**Wrong:** Searching the plans directory for a plan to build.
**Right:** Use the plan path that `/ce-plan` reported writing this run.

**Wrong:** Sending a Routine fix to Grok because it is "more careful."
**Right:** Route by `fix_complexity` and `specific_fix` using the table in 6d.

**Wrong:** Re-running the full review after the fixes.
**Right:** Run only the diff re-check in 6f.

**Wrong:** Merging after CI passes.
**Right:** Stop at the open PR and hand off.

---

**Begin Stage 0: check the branch, check for a remote, and classify the request.**
