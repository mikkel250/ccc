---
status: completed
priority: p3
issue_id: "013"
tags: [code-review, architecture, module-boundaries, typescript]
dependencies: []
---

# Extract `KNOWN_PROVIDERS` to a leaf module and eliminate the `llm ↔ env` circular import

## Problem Statement

`KNOWN_PROVIDERS` is owned by `app/api/lib/llm.ts` (line 55), but `lib/env.ts` needs it at module init time to validate `AI_MODEL` / `TAILOR_MODEL` / eval model env vars. A static ESM import of `llm.ts` from `env.ts` would create a circular dependency (llm → env → llm), so `env.ts:104` reaches into `llm.ts` via **CommonJS `require`** inside a `try/catch`, with an env-derived fallback when the require returns an empty/partial module (which it can, mid-cycle).

This works. It is also a landmine:

- On any change to module init order (Next.js SWC transforms, Turbopack, jest transformer choice), the `require()` may silently return `{}` and quietly fall back to the env-derived provider set. There is no runtime signal.
- The chaos audit added a `console.warn` when `require()` *throws* (fix #4 in that session), but if it returns a partial module the sanitization silently produces `null` and falls back with no warning.
- The pattern violates AGENTS.md: "Config-driven routing" wants the provider registry to be data, not something extracted via a cross-module `require`.

## Findings

- **File:** `app/api/lib/llm.ts:55` — `export const KNOWN_PROVIDERS = new Set<Provider>([...])`.
- **File:** `lib/env.ts:98-115` — `getProviderRegistry()` uses `require('../app/api/lib/llm')` with try/catch fallback.
- **File:** `tests/env.test.ts:230-296` — three tests explicitly assert the require-cycle fallback behavior. They stub `envRequire.cache[llmModuleId]` and check that `getTailorModel()` still works. If `KNOWN_PROVIDERS` is moved to a leaf module, this failure mode ceases to exist and these tests test nothing real.
- **Related:** Chaos audit Loop 2 finding **L2-03** (identified but not shipped to keep blast radius small).

## Proposed Solutions

### Option 1: Extract to `lib/providers.ts` (Recommended)

**Approach:** Create a new leaf module that owns the provider type and registry. Both `llm.ts` and `env.ts` import from it statically.

```typescript
// lib/providers.ts (new)
export type Provider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'deepseek';
export const KNOWN_PROVIDERS = new Set<Provider>([
  'openai', 'anthropic', 'google', 'openrouter', 'deepseek',
]);
```

```typescript
// app/api/lib/llm.ts
import { KNOWN_PROVIDERS, type Provider } from '../../../lib/providers';
// re-export for backward compat with tests/other importers:
export { KNOWN_PROVIDERS, type Provider };
```

```typescript
// lib/env.ts
import { KNOWN_PROVIDERS } from './providers';
// remove require() + sanitizeProviderRegistry() + getProviderRegistry() entirely.
// validateDefaultModel uses KNOWN_PROVIDERS directly.
```

**Update `tests/env.test.ts`:**
- Delete the three tests at lines 257-296 that assert the require-cycle fallback behavior. Their failure mode disappears with this refactor. Per AGENTS.md testing philosophy: "If renaming a heading or restructuring a doc file breaks a test, the test was testing the wrong thing."
- Keep tests at lines 242-254 (they verify `LLM_CONFIG.defaultModel` shape — still valid post-refactor).
- Add one new test asserting `KNOWN_PROVIDERS` is imported from the leaf module (a structural invariant check).

**Pros:**
- Kills the circular import at the source. No `require()` inside `.ts` files.
- Eliminates ~30 lines of defensive fallback code (`sanitizeProviderRegistry`, `getConfiguredProviderFallback`, `getProviderRegistry`, `cachedProviderRegistry`, `resetProviderRegistryCache`).
- The `Provider` type moves out of `llm.ts` too, which is architecturally cleaner — providers are cross-cutting.
- Test suite gets simpler (three tests deleted, one added).

**Cons:**
- Requires updating existing tests. Blast-radius reason the chaos audit deferred it.
- Breaks any external import that assumes `llm.ts` is the canonical location for `Provider` (mitigated by re-export).

**Effort:** Medium (1–2 h including test updates and verification)

**Risk:** Low — the refactor removes complexity; the deleted tests were testing a failure mode that no longer exists.

---

### Option 2: Leave as-is, just add stronger diagnostics

**Approach:** Keep the `require()` cycle but add a `console.warn` when `sanitizeProviderRegistry` returns `null` (currently only warns when `require()` throws — chaos audit fix #4). Also add a startup assertion in `instrumentation.ts` that logs the resolved provider registry once so operators can see the actual set at boot.

**Pros:**
- No test changes.
- Preserves defence-in-depth against future circular-import breakage.

**Cons:**
- Complexity stays.
- Every future contributor still has to understand the require-cycle fallback path.

**Effort:** Small (30 min)

**Risk:** Very Low

## Recommended Action

**To be filled during triage.** Option 1 is the correct architectural fix; Option 2 is a stopgap if the test-update work is contentious.

## Technical Details

**Affected files (Option 1):**
- New: `lib/providers.ts` (~10 lines)
- `app/api/lib/llm.ts` — replace inline `KNOWN_PROVIDERS` with re-export
- `lib/env.ts` — delete `sanitizeProviderRegistry`, `getConfiguredProviderFallback`, `getProviderRegistry`, `cachedProviderRegistry`, `resetProviderRegistryCache` (~50 lines removed); `validateDefaultModel` uses `KNOWN_PROVIDERS` directly
- `tests/env.test.ts:257-296` — delete require-cycle fallback tests; adjust exports imports

**Verification:**
- `npm test` — all tests pass, including the eval-tailor-model-default cross-file invariant test.
- `npm run lint` clean.
- Grep for `require(` in `lib/` and `app/api/` — should be zero after this change.

## Resources

- **Chaos audit report** (session `feature/chaos-audit-2026-07-04`): Loop 2 finding L2-03.
- **AGENTS.md:** "Config-driven routing, code-driven integration."
- **AGENTS.md testing philosophy:** "Tests should survive refactoring. If renaming a markdown heading or restructuring a doc file breaks a test, the test was testing the wrong thing. Ask: 'would this failure indicate a real bug?' If not, delete the test."

## Acceptance Criteria

- [ ] No `require(` calls inside `.ts` files under `lib/` or `app/api/lib/`.
- [ ] `KNOWN_PROVIDERS` and `Provider` type live in a leaf module both `llm.ts` and `env.ts` import statically.
- [ ] `tests/env.test.ts` updated: obsolete circular-cycle tests deleted, remaining tests still assert real invariants.
- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] Backward-compatible re-export means external importers of `KNOWN_PROVIDERS` from `llm.ts` are not broken.

## Work Log

### 2026-07-04 — Initial Discovery (Chaos Audit)

**By:** Cursor agent, `feature/chaos-audit-2026-07-04`

**Actions:**
- Flagged during Loop 2 refactoring survey (L2-03).
- Deferred out of the chaos-audit PR because the fix requires updating `tests/env.test.ts` — a wider blast radius than the other Loop 3 fixes in that session.
- Instead, chaos audit fix #4 added a `console.warn` inside the `require()` catch as a stopgap so at least the throwing case is no longer silent.

**Learnings:**
- The existing test suite explicitly tests the require-cycle fallback, so any extraction requires deleting or rewriting those tests. This is the reason the fallback exists — but per AGENTS.md, tests should describe real invariants, not implementation quirks.
- The fallback path in `getConfiguredProviderFallback` is coupled to knowing about `DEFAULT_LLM_MODEL`, `DEFAULT_TAILOR_MODEL`, and the eval defaults — deleting this reduces `lib/env.ts` LOC by ~50.

### 2026-07-05 — Resolved (Option 1)

**By:** Work execution agent, `feature/close-code-review-todos-batch`

**Actions:**
- Created `lib/providers.ts` (leaf module, no imports of its own) owning `Provider` and `KNOWN_PROVIDERS`.
- `llm.ts` imports statically and re-exports both for backward compatibility with existing importers.
- `lib/env.ts` imports `KNOWN_PROVIDERS` directly and deletes `sanitizeProviderRegistry`, `addProviderFromModel`, `getConfiguredProviderFallback`, `cachedProviderRegistry`, `resetProviderRegistryCache`, `getProviderRegistry` (~100 lines removed including the `require()` call and its try/catch).
- `tests/env.test.ts`: deleted the two `describe` blocks asserting require-cycle fallback behavior (and their `envRequire`/`stubLlmKnownProviders`/`Module` scaffolding); added a structural-invariant test asserting `KNOWN_PROVIDERS` from `llm.ts` and from `lib/providers.ts` are reference-equal, plus a direct "unknown provider throws" test replacing the old fallback-path coverage.
- `grep -rn "require(" lib/ app/api/lib/ --include="*.ts"` returns zero matches.
- `npm test`, `npm run lint`, `npm run build` all pass.
