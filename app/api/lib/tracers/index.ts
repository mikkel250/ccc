/**
 * Composite dispatcher for tracer adapters — the single import `llm.ts::chat()` needs.
 *
 * Flush semantics are preserved per-adapter from the pre-refactor implementation:
 * LangSmith is fire-and-forget (serverless-safe by design, no flush step), Langfuse
 * MUST be awaited so `flushLangfuseTraces()` completes before the serverless
 * container freezes — without the await, traces vanish on cold-instance shutdown.
 */
import { langsmithTracer } from './langsmith';
import { langfuseTracer } from './langfuse';
import type { TracePayload } from './tracer';

export type { TracePayload, Tracer } from './tracer';
export type { LangfusePromptRef } from './langfuse';

/** Fire-and-forget — matches LangSmith's existing serverless-safe semantics. */
export function recordLangSmithTrace(payload: TracePayload): void {
  langsmithTracer
    .record(payload)
    .catch((err) => console.error(`Trace failed (${langsmithTracer.name}):`, err));
}

/** Awaited — caller must await so the Langfuse flush completes before returning. */
export async function recordLangfuseTrace(payload: TracePayload): Promise<void> {
  await langfuseTracer
    .record(payload)
    .catch((err) => console.error(`Trace failed (${langfuseTracer.name}):`, err));
}
