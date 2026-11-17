# Cursor Portable Config — Quickstart

A drop-in engineering workflow for Cursor projects. All work happens on feature branches, pushed via PR, with CodeRabbit review. Direct commits to `main` are blocked at the remote level.

Cursor Auto handles execution by default. You own architecture, trade-offs, and acceptance. AI handles boilerplate, synthesis, and review. You handle judgment.

For the daily workflow, command reference, and model routing, see **`WORKFLOW_QUICKREF.md`**.

---

## What you get

Two layers: **Cursor-native config** (lives under `.cursor/` so one clone installs everything Cursor reads) and **project artifacts** (blank templates from this repo, filled in per project under `.cursor/artifacts/`).

**Declarative layout:** coordination files (`CURRENT_PLAN`, `OPEN_QUESTIONS`, `ARCHITECTURE`, etc.) exist **only** under `.cursor/artifacts/` in the host repository — never at repo root. Agents will not look elsewhere for them.

### Portable pack — what lives under `.cursor/`

```
.cursor/
  rules/
    gitSafety.mdc          ← branch safety — never commit to main (alwaysApply: true)
    agentRules.mdc         ← always-applied agent behavior (alwaysApply: true)
  commands/
    *.md                  ← slash commands (/0-pair-programmer, /1-task-definition, …)
  skills/
    <skill-name>/
      SKILL.md            ← optional Agent Skills
  hooks.json              ← registers hook scripts (points into hooks/ at repo root)
  mcp.json                ← optional; project MCP server list
```

### Tracked project layout (host repo root)

```
.cursor/artifacts/                ← required; sole location for coordination markdown
  CURRENT_PLAN.md
  OPEN_QUESTIONS.md
  REVIEW_NOTES.md
  ARCHITECTURE.md
  ENGINEERING_LEARNINGS.md
hooks/                    ← hook scripts (kept at root so they survive .cursor/ clones)
  check-open-questions.sh ← alerts on unresolved Blocking entries after any agent run
  check-review-notes.sh   ← alerts on Critical findings and prompts /5a-review-validate
config/
  models.md               ← model routing reference
RUN_ME_FIRST.md            ← one-time bootstrapping prompt for new projects
WORKFLOW_QUICKREF.md      ← daily workflow reference
```

---

## Map of Cursor features

| concept | What Cursor actually loads | Notes |
|--------------|------------------------------|--------|
| Persistent agent behavior (old `.cursorrules`) | `.cursor/rules/*.mdc` | Global behavior in one file with `alwaysApply: true`. Stack-only bullets in a separate `.mdc` with `globs`. |
| Prompts you invoke | `.cursor/commands/*.md` | Becomes slash commands; filename drives the command name. |
| Coordination markdown | `.cursor/artifacts/*.md` only | Not a Cursor magic path. Add to Settings → Docs (see step 4 below). |
| Hooks config | `.cursor/hooks.json` | Script paths are relative to the **project root**. Scripts themselves live in `hooks/` at root so they survive being cloned inside `.cursor/`. (With `artifacts/` now under `.cursor/`, hook scripts need to reference `.cursor/artifacts/`.) |
| CodeRabbit config | `.coderabbit.yaml` at repository root | Required. Review runs after `/6-commit` pushes the branch. |

---

## 15-Minute Setup

### 1. Install the portable pack (2 min)

```bash
cd your-project
mkdir -p .cursor
git clone git@gitlab.com:mikkel250/utils.git .cursor/utils
# Then copy rules/ and commands/ to sit directly under .cursor/
```

```bash
mkdir -p .cursor/artifacts
cp -r .cursor/utils/artifacts/. .cursor/artifacts/
```

Coordination files must end up as `.cursor/artifacts/<name>.md`, not at repository root. If `.cursor/` is gitignored locally, keep the pack as a submodule so updates stay reproducible.

### 2. Run the setup prompt (5 min)

Open `RUN_ME_FIRST.md`. Paste it into a new Cursor Agent chat (recommended model: **Gemini 3.1 Pro Flex** for best structured output; **DeepSeek V4 Pro** is a solid alternative) along with:
- Your stack (language, framework, key dependencies)
- Your project purpose in 2–3 sentences
- Any known constraints (auth model, deployment target, etc.)

Output: a populated `.cursor/artifacts/ARCHITECTURE.md` and a `rules/agentRules.mdc` body ready to save.

**Direct clone only** — if you cloned `utils` directly into `.cursor/` (not the `.cursor/utils` copy flow below), keep filled-in artifacts local-only so you do not push project content to the shared pack:

```bash
cd .cursor
for f in $(git ls-files artifacts/); do git update-index --skip-worktree "$f"; done
```

See `README.md` → *Project-local artifacts* for why this is needed and how to undo it before pulling template updates.

### 3. Verify model IDs (3 min)

Open `config/models.md`. Confirm each model slug resolves correctly in OpenRouter or your Cursor settings. Model IDs change — treat this as a checklist before each new project.

### 4. Add stable artifacts to Cursor Docs (2 min)

In **Cursor Settings → Docs**, add:
- `.cursor/artifacts/ARCHITECTURE.md`

Do **not** add any other artifacts. Session-state files (`CURRENT_PLAN`, `OPEN_QUESTIONS`, `REVIEW_NOTES`) change every session — an indexed version will be stale. `ENGINEERING_LEARNINGS` is read directly by agents via file tools when needed. Docs indexing adds no value for either.

### 5. Enable workflow hooks (1 min)

The repo ships with two `stop`-event hooks that fire after every agent run:

| Script | What it does |
|--------|-------------|
| `hooks/check-open-questions.sh` | Surfaces any unresolved `## Blocking` entries from `.cursor/artifacts/OPEN_QUESTIONS.md` so you don't accidentally proceed past a blocker. |
| `hooks/check-review-notes.sh` | Detects `Severity: Critical` findings or `Needs Human Review` escalations in `.cursor/artifacts/REVIEW_NOTES.md` and reminds you to run `/5a-review-validate` before `/6-commit`. |

Both fail open — a crash or missing file is silently ignored.

**To disable a hook temporarily:** comment out or remove its entry in `.cursor/hooks.json`. Save the file; Cursor reloads hooks automatically. No restart needed.

**To disable hooks entirely:** delete or empty `.cursor/hooks.json`.

**To verify hooks are loaded:** Cursor Settings → Hooks tab — each registered hook appears there with its last run status.

### 6. Install CodeRabbit (3 min)

CodeRabbit provides automated PR-level review. Install the GitHub App at https://www.coderabbit.ai. Config is already at `.coderabbit.yaml`. After `/6-commit` pushes, open or refresh the PR and wait for CodeRabbit before merging.

- **CodeRabbit** — install the GitHub App: https://www.coderabbit.ai. Config is already at `.coderabbit.yaml`. After `/6-commit` pushes, open or refresh the PR and wait for CodeRabbit before merging.
- **Bugbot** (optional alternative/supplement) — Cursor-native PR review. Enable it in Cursor Settings → Bugbot. Reads full PR context, finds logic errors, and can propose fixes via autofix. See [Bugbot docs](https://cursor.com/docs/bugbot.md).

---

## You're ready

See `WORKFLOW_QUICKREF.md` for the command sequence, model routing, per-task loop, decision gates, and troubleshooting.

**Remember: all work uses feature branches. Never commit directly to `main` — it's blocked at the remote level.**

---

## Additional notes and tips, advanced usage
Cursor has a number of built-in features that can be taken advantage of, such as agent Modes, Skills, and Hooks.
Here are some notes from their docs that might be helpful maximizing workflow and productivity.

### Using Plan mode, and when to start over
Sometimes the agent builds something that misses the mark. Instead of trying to fix it through follow-up prompts, go back to the plan. Revert the changes and refine the plan to be more specific before running it again.

For example, if you missed a key architecture or system design note, the plan might build the wrong thing. Starting over from the plan feels counterintuitive, but it's often faster than patching an approach that started with the wrong direction.

### Test-driven development with agents
https://cursor.com/learn/creating-features#test-driven-development-with-agents
Agents do their best work when they can tell whether their code is correct. When a test fails, the agent can see what went wrong and try again.

Engineers have used test-driven development for a long time, but it wasn't always the most popular way of writing code. With agents, it's much easier to write tests first, and those tests pay off as your codebase grows.

Write tests first. Ask the agent to write tests based on the expected inputs and outputs. Be explicit you're doing TDD, so it doesn't create mock functions for code that doesn't exist yet.
Confirm the tests fail. Tell the agent to run the tests and verify they fail. You're not trying to write feature code at this point.
Commit the tests. When you're satisfied with the test coverage and quality, commit them. This locks in your requirements for the agent to build against.
Ask the agent to write code. Tell it to make all tests pass without modifying the tests. Keep iterating until everything passes.
Commit the code. Review the output, confirm it behaves as expected, and commit.

Once the tests are committed, tell the agent to write the code. Be explicit that it should make all tests pass without modifying the tests.

Why does this work so well? Because the agent can run tests, see failures, adjust its code, and try again. Each test run gives the agent concrete feedback. Without tests, it has no way to know if the code changes it made work.

This approach is especially valuable for backend code where you can't verify correctness by looking at a screen. You describe the expected behavior in your tests, and the agent writes the code to match.

### Design to code
You can also connect the Figma MCP server so the agent can pull design tokens, variables, and component specs directly from your Figma files.
The integrated browser lets you preview changes as the agent makes them. With this browser, the agent can navigate pages, take screenshots, and verify its own visual output. This saves you from manually passing screenshots back to the agent.

### Debugging
Probably best to just directly read their docs: https://cursor.com/learn/finding-fixing-bugs#debugging-fundamentals
#### Run multiple models in parallel
For hard bugs, different models sometimes find different things. Cursor lets you run the same debugging prompt across multiple models simultaneously. Each agent works in isolation, so they won't interfere with each other.

The workflow:

Write a clear debugging brief with the reproduction steps and your hypotheses
Select multiple models from the agent dropdown
Submit the prompt; each model works independently
Compare the proposed fixes from each model
Keep the approach with the strongest evidence
Cursor will suggest which solution it believes is best, but you should evaluate the reasoning, not only the final solution. To further confirm the accuracy of the fix, you can ask the model to verify its work and ensure it's the correct solution.

## Common failure pattern: accepting fixes you don't understand
If you don't understand the fix, you can't validate whether it's correct. The agent might add a null check that makes the error go away, but the underlying data inconsistency remains.

When the agent proposes a fix, ask questions until you understand it. Why is that value null? What changed to cause this? Is this the root cause, or are we masking the symptom? As we covered in foundations, agents can hallucinate plausible-sounding explanations. You need to develop your own understanding and use the data from your investigation to confirm the agent has identified the real root cause.

## Reviewing and testing code
https://cursor.com/learn/reviewing-testing

## Example of Cursor recommended workflow
https://cursor.com/learn/putting-it-together