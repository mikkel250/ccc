# PR: Add `model` parameter to `subagent` tool tasks

## Summary

The `subagent` tool's `tasks[]` items (parallel mode) and `chain[]` items (chain mode) currently only accept `agent`, `task`, and `cwd`. There is no way to specify a model per task — all subagents use the parent Pi session's default model.

This PR adds an optional `model` parameter to per-task `SubagentTask` items, threaded through to the `pi --model` CLI flag.

## Changes

**3 locations** in `src/templates/pi/compat-extension.ts` (template source) and the same 3 in `extensions/compound-engineering-compat.ts` (active extension):

### 1. `SubagentTask` type — add `model?: string`
```typescript
type SubagentTask = {
  agent: string
  task: string
  cwd?: string
+ model?: string
}
```

### 2. `runSingleSubagent` — pass `--model` to `pi` CLI when set
```typescript
+ const modelFlag = task.model ? " --model " + shellEscape(task.model) : ""
  const prompt = "/skill:" + agent + " " + taskText
- const script = "cd " + shellEscape(cwd) + " && pi --no-session -p " + shellEscape(prompt)
+ const script = "cd " + shellEscape(cwd) + " && pi --no-session" + modelFlag + " -p " + shellEscape(prompt)
```

### 3. `subagentTaskSchema` — add `model` to TypeBox schema
```typescript
  const subagentTaskSchema = Type.Object({
    agent: Type.String(...),
    task: Type.String(...),
    cwd: Type.Optional(Type.String(...)),
+   model: Type.Optional(Type.String({
+     description: 'Optional model override. Accepts "provider/modelId" or fuzzy name (e.g. "haiku", "sonnet"). Omit to use Pi session default.'
+   })),
  })
```

## Usage

After this change, the orchestrator can specify per-task models:

```json
{
  "tasks": [
    {
      "agent": "kieran-typescript-reviewer",
      "task": "Review the auth module",
      "model": "openrouter/auto-beta"
    },
    {
      "agent": "security-sentinel",
      "task": "Audit the auth module",
      "model": "openrouter/openai/gpt-5.4"
    }
  ]
}
```

When `model` is omitted, behavior is unchanged — subagent inherits Pi's session default.

## Why this approach (not `createAgentSession`)

The `subagent` tool currently shells out to `pi --no-session`. The alternative would be to use Pi's `createAgentSession` API (as `@tintinweb/pi-subagents` does), which would give full `thinking`, `maxTurns`, `inheritContext`, and live widget support per task. However, that requires:

- Adding `@earendil-works/pi-coding-agent` as a direct dependency
- Importing `createAgentSession`, `DefaultResourceLoader`, `SessionManager`, `SettingsManager`
- Reimplementing skill loading and agent prompt building
- ~100+ lines changed vs 3

This PR takes the minimal approach. The session-based integration is documented here as a potential follow-up.

## Testing

```bash
# Verify pi --model works with a skill
pi --no-session --model "deepseek/deepseek-v4-flash" -p "/skill:kieran-typescript-reviewer Look at lib/env.ts"

# After /reload, verify the orchestrator can pass model per task
# (test via any workflow that uses parallel subagents with model override)
```

## Compatibility

- **Non-breaking**: `model` is optional, omitted = current behavior
- **Pi version**: `pi --model` has been supported since at least v0.80
- **Chain mode**: `{previous}` placeholder works as before; model is per-step

## Bug Fix: Single & Chain Mode Model Propagation

Single mode (`agent`+`task`) and chain mode (`chain[]`) originally reconstructed
`SubagentTask` objects without `model`, dropping the override. Fixed by adding
`model: params.model` and `model: step.model` respectively.

**Regression test spec** (for upstream test suite):

```typescript
// Chain: two steps with different models, verify both are passed through
test("chain preserves per-step model overrides", async () => {
  const results = await runSingleSubagent.mock.results;
  // Step 1 called with model A
  expect(results[0].model).toBe("model-a");
  // Step 2 called with model B
  expect(results[1].model).toBe("model-b");
});

// Single: model override passed through
test("single mode passes model override", async () => {
  const results = await runSingleSubagent.mock.results;
  expect(results[0].model).toBe("deepseek/deepseek-v4-flash");
});
```
