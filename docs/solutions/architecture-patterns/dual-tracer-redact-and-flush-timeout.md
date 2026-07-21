---
title: Dual-tracer serverless hardening (LangSmith redact + Langfuse flush timeout)
date: 2026-07-20
category: architecture-patterns
module: app/api/lib/tracers
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - Unifying multiple observability backends behind a shared Tracer interface
  - Recording LLM chat traces that may include messages, system prompts, or CV content
  - Awaiting provider flush (e.g. Langfuse forceFlush) on the serverless request path
tags:
  - langsmith
  - langfuse
  - tracer
  - redaction
  - flush-timeout
  - observability
  - pii
  - serverless
---

# Dual-tracer serverless hardening (LangSmith redact + Langfuse flush timeout)

## Context

Tracer unification folded LangSmith and Langfuse behind a shared `Tracer` / `TracePayload` contract so `chat()` dispatches once and adapters own backend-specific export. That correctly preserved asymmetric flush semantics: LangSmith stays fire-and-forget; Langfuse must be awaited so `flushLangfuseTraces()` can finish under `exportMode: "immediate"` before a short-lived Route Handler freezes (`app/api/lib/tracers/index.ts`, `app/api/lib/llm.ts`).

(session history) A chaos audit first found the error path still fire-and-forgot Langfuse, so failure traces vanished on cold freeze; that was fixed by awaiting Langfuse on both success and error. Unification and flush-semantics tests followed on PR #14. CodeRabbit then flagged two residual gaps that the final review fix closed:

1. **Privacy** — LangSmith `createRun` still shipped full messages, system prompt, and response content (career/CV PII). Langfuse later needed the same adapter-level redaction before JSON-curator cutover (R8b).
2. **Availability** — unbounded awaited `forceFlush()` could stall every `chat()` if Langfuse hung.

(session history) Redaction was implemented in application `traceData` before `createRun` so content never depends on vendor project settings alone; prefer adapter-level redaction even when the SDK also offers hide/anonymizer knobs.

## Guidance

Treat dual tracers as **two contracts**, not one shared “trace everything” path.

**LangSmith — redact content; keep metrics.** In the LangSmith adapter, replace prompt and completion bodies with `[REDACTED]` before `createRun`, while still exporting provider/model, usage, duration, and token settings (`app/api/lib/tracers/langsmith.ts`). Do not rely on vendor project settings alone.

**Langfuse — same content redaction parity.** The Langfuse adapter must also replace messages, system prompt, and response content with `[REDACTED]` in `generation.update()` input/output (`app/api/lib/tracers/langfuse.ts` via `buildLangfuseGenerationUpdate`). Keep usage, model, duration, and source metadata. Do not log raw `TracePayload` bodies on adapter failure.

**Langfuse — await record + flush; bound the wait.** Keep `recordLangSmithTrace` fire-and-forget and `await recordLangfuseTrace` on both success and error paths (`app/api/lib/llm.ts`). Race `forceFlush()` against `LANGFUSE_FLUSH_TIMEOUT_MS` (default 5000 ms, min 1). On timeout or failure, warn and continue — do not fail the LLM call (`app/api/lib/langfuse-otel.ts`). Catalog the env var in `.env.example`.

**Shared payload hygiene.** Pass `toTraceOptions(options)` into `TracePayload` so injectable SDK clients never serialize into traces (`app/api/lib/tracers/tracer.ts`).

**Do not collapse the asymmetry.** Fire-and-forget Langfuse drops spans on cold shutdown; awaiting LangSmith couples request latency to a second vendor for little gain.

## Why This Matters

- Enabling `LANGSMITH_TRACING=true` without adapter redaction exports CV/job-description text to a third party.
- Awaiting Langfuse without a timeout turns a slow observability backend into a hung tailor-cv request.
- Asymmetric await is what makes dual tracing correct on serverless; the review fixes make that safe for privacy and latency.

## When to Apply

- Adding or unifying multiple LLM observability backends on short-lived Node/Next.js routes.
- Shipping traces that could include user documents, CVs, or prompts — redact at the adapter that leaves the trust boundary.
- Using Langfuse (or any OTEL exporter) with immediate/force-flush export on the request path.
- Reviewing tracer PRs: verify fire-and-forget vs await still matches each backend, and that flush waits are env-bounded.

## Examples

**LangSmith redaction:**

```44:67:app/api/lib/tracers/langsmith.ts
    const traceData = {
      name: `llm_call_${provider}_${model}`,
      // ...
      inputs: {
        provider,
        model,
        messages: REDACTED,
        system_prompt: REDACTED,
        options,
      },
      outputs: {
        content: REDACTED,
        usage: response.usage,
      },
      // ...
    };
```

**Asymmetric dispatch from `chat()` (success path; error path mirrors):**

```588:589:app/api/lib/llm.ts
    recordLangSmithTrace(tracePayload);
    await recordLangfuseTrace(tracePayload);
```

**Bounded flush:** `flushLangfuseTraces()` reads `LANGFUSE_FLUSH_TIMEOUT_MS` and races `forceFlush()` (`app/api/lib/langfuse-otel.ts:60-95`). Default documented in `.env.example`.

**Caveat:** Langfuse’s adapter still records full message/prompt/content into the generation. PR #14 hardened LangSmith; if Langfuse sits outside your trust boundary, treat content redaction there as a separate follow-up.

## Related

- [PR #14](https://github.com/mikkel250/ccc/pull/14) — Tracer unification + review fixes (LangSmith redact; `LANGFUSE_FLUSH_TIMEOUT_MS`)
- [Upstash Redis rate-limit migration](../upstash-redis-rate-limit-migration.md) — same institutional rule: env-bounded timeouts on external service calls
- Plan: `docs/plans/2026-07-05-001-refactor-close-outstanding-code-review-todos-plan.md`
