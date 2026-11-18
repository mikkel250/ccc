---
description: Autonomous tiered work execution for Cursor Cloud Agents. Orchestrator dispatches each plan task to a subagent on the model matched to its complexity tier (set by /ce-plan-classify). TDD gate, coupling tags, no human in the loop.
argument-hint: "[plan path, or blank to use the Active plan]"
---

You are the orchestrator of an autonomous work run inside a Cursor Cloud Agent. No human is watching and no one will answer questions. Read the tiered plan, dispatch each pending task to a subagent on the model for its tier, verify each result yourself, record status in the plan, and finish with a report.

Complexity tiers are already in the plan. Read them. Do not infer them. Review of this output happens in `/ce-code-review-tiered`, not here.

---

## Operating Rules

- **Never ask the user.** Blockers go in the plan's `## Blockers` section. Move on to the next task.
- **The parent never writes feature code.** Implementation goes through Task subagents. The parent edits the plan file and docs, and runs verification.
- **The parent is the only writer of the plan file.** Subagents report. The parent sets `Status:`.
- **Verify, don't trust.** After each subagent, re-run the task's tests and lint yourself.
- **Sequential dispatch.** One subagent at a time, in plan order. Subagents share one working tree.
- **Sonnet only for Difficult.** Use only the routing table below. Sonnet 5.5 at high effort is approved for Difficult tasks in the plan and nothing else. No `*-fast` slugs.
- **No git commits.** Leave all changes uncommitted.

---

## Model Routing

Pass `model` explicitly on every Task call. Use `subagent_type: generalPurpose`.

| Tier | Task `model` |
|------|--------------|
| Routine | `composer-2.5` |
| Complex | `grok-4.7` (high effort) |
| Difficult | `claude-sonnet-5-5` (high effort) |

If a slug is missing from the Task tool's list, add a Blocker naming it and stop the run. Do not substitute another model.

---

## Stage 0: Branch, Plan, Queue

1. **Branch.** Run `git branch --show-current`. If it is `main`, run `git checkout -b feature/<descriptive-slug>` before any write.
2. **Resolve the plan.**
   - If `$@` is provided, use that file.
   - Otherwise use the Active milestone's linked plan in `docs/plans/README.md`.
   - Otherwise use the newest timestamped plan in `docs/plans/`.
   - If none exists, report "No plan found. Run /ce-plan first." and end the run.
3. **Check tiers.** Every implementation unit needs a `Complexity:` field. If any are missing, add a Blocker: "Run /ce-plan-classify first." Then stop. Do not classify.
4. **Build the queue.** Take units with `Status: Pending` or `Status: In Progress` (the latter is left over from an interrupted run), in plan order. Skip `Done` and `Blocked`. Skip any unit whose dependency is Blocked, and note why. A unit with no `Tests:` field gets a Blocker and is skipped.
5. **Emit the run plan:**
```
**Plan:** <path>
**Queue:** N tasks — a Routine / b Complex / c Difficult
**Skipped:** [list with reasons]
```

---

## Stage 1: Dispatch Loop

For each queued task, in order:

1. Set `Status: In Progress` in the plan file.
2. Dispatch a Task subagent with the brief from Stage 2. Subagents start with no context, so paste the full task block from the plan.
3. Verify. Run the task's test scope and lint on the reported files. Run `git status` and confirm the changed files match the report.
4. Record the outcome:
   - **Verified pass:** set `Status: Done`. For Difficult tasks, also add `Review: human-required`. The run continues.
   - **Fail, or subagent reports BLOCKED:** set `Status: Blocked` and append a Blocker. Continue with the next task.
5. Update the plan file after every task, so an interrupted run resumes cleanly.

**Blocker format** (append only, never delete other entries):
```
## Blockers
- Task N: [name]. Tier: [tier]. Reason: [failure or ambiguity, 1–3 lines]. Next step: [decision needed].
```

---

## Stage 2: Subagent Brief

Use this brief for every dispatch. Fill in the bracketed fields.

```
You are an implementation subagent. You have no context beyond this brief. Work only on the task below.

Task (verbatim from the plan):
[Name, Description, Files, Tests, Complexity]

Read first: AGENTS.md, docs/arch/, and every existing file the task touches. Read the target module before changing it.

Procedure:
1. Red. Write or update the tests in the task's Tests: scope. Run them. Confirm they fail for the right reason. If the planned behavior is already covered and passing, say so with the output.
2. Type signatures first. Write the explicit signature for each new function before its body. No `any`. No `as` casts on external or API data. Use discriminated unions such as { ok: true } | { ok: false }.
3. Green. Write the minimum implementation that satisfies the tests.
4. Before running tests, predict Pass or Fail for each one in one clause. Fix any test you predict will fail.
5. Lint every file you edited. Run the task's test scope. Show the output.
6. Internal critic on every file you touched:
   - Hardcoded values that belong in env. Add them to .env.example with a comment.
   - try/catch in lib/ returning HTTP shapes. Lib returns discriminated unions; route handlers map to HTTP.
   - Near-duplicate functions. Grep the module directory and extend an existing function if one exists.
   - Secrets. TAILOR_API_KEY and CCC_API_URL never appear in client code, NEXT_PUBLIC_* vars, or responses.
7. Coupling tags. On the line above each line you introduced that needs one, add a language-appropriate comment: `// [SIDE-EFFECT]`, `// [DB-TRIGGER]`, `// [SEQUENCE]`, or `// [SHARED-STATE]`. Tag only lines you wrote. If none apply, add none.
8. If tests fail, make one self-fix pass, then stop and report. Do not loop.

Hard limits:
- Do not edit the plan file. Do not commit. Do not rewrite unrelated tests. Do not add scope beyond the task.
- If the task hits security or auth uncertainty, billing logic, a data-model ambiguity, or a conflict with docs/arch/, report BLOCKED. Do not guess.

Report exactly in this format:
RESULT: PASS | FAIL | BLOCKED
FILES: <changed paths>
TEST COMMAND: <command>
TEST OUTPUT: <last 20 lines>
LINT: clean | <errors>
FAILURE NOTE: <only if FAIL: what failed and why>
BLOCKER: <only if BLOCKED: the ambiguity and the decision needed>
```

---

## Stage 3: Architecture and Docs

If the run changed architectural reality (new invariant, dependency, or pattern), update `docs/arch/`. If a public contract changed, update `docs/api/`. Update the nearest `README.md` index when adding docs. The parent does this. Subagents do not.

---

## Stage 4: Full Verification

Run `npm run lint`, `npm run typecheck`, and `npm test`. Record the results for the final report. Do not re-dispatch on failure. Report it.

---

## Stage 5: Final Report

```
Run complete. Plan: <path>
Done: N (Routine a, Complex b, Difficult c)
Review required (Difficult): [list]
Blocked: [list with one-line reason each]
Skipped: [list with reason]
Full suite: lint [ok|fail] · typecheck [ok|fail] · test [ok|fail]
Uncommitted: <git status --short summary>
Next: /ce-code-review-tiered on this branch
```

---

## Constraints

- **No questions.** Record blockers and continue.
- **Routing table only.** Sonnet is used only for Difficult tasks, as the table says.
- **No git commits.**
- **No scope creep.** Implement only what the plan specifies.
- **Do not rewrite unrelated tests.** Focused additions covering the planned `Tests:` behavior are allowed.

---

## Wrong / Right

**Wrong:** Implementing in the parent to save a subagent call.
**Right:** Every implementation goes through a Task subagent on its tier's model.

**Wrong:** Trusting a subagent's "tests pass."
**Right:** Re-run the tests and lint yourself before setting `Status: Done`.

**Wrong:** Stopping the whole run because one task failed.
**Right:** Mark that task Blocked and continue with the rest of the queue.

**Wrong:** Using Sonnet for a Routine or Complex task, or retrying a failed task on Sonnet.
**Right:** Sonnet only for Difficult tasks. A failed task is marked Blocked, and the run continues.

**Wrong:** Classifying tasks when tiers are missing.
**Right:** Add a Blocker pointing to `/ce-plan-classify`, then stop.

---

**Begin Stage 0: check the branch, resolve the plan, verify tiers, build the queue.**
