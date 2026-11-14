/**
 * Tracer adapter exports — the two helpers `llm.ts::chat()` couples directly.
 *
 * Flush semantics are preserved per-adapter from the pre-refactor implementation:
 * LangSmith is fire-and-forget (serverless-safe by design, no flush step), Langfuse
 * MUST be awaited so `flushLangfuseTraces()` completes before the serverless
 * container freezes — without the await, traces vanish on cold-instance shutdown.
 */
import { getLangfuseFlushTimeoutMs } from '../langfuse-otel';
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

/**
 * Awaited so the Langfuse flush can finish before the caller returns.
 * The wait is capped by `LANGFUSE_FLUSH_TIMEOUT_MS`. On timeout the caller
 * continues; a hung export must not hold HTTP or inbox work open.
 */
export async function recordLangfuseTrace(payload: TracePayload): Promise<void> {
  const timeoutMs = getLangfuseFlushTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`Langfuse trace timed out after ${timeoutMs}ms`);
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([
      langfuseTracer
        .record(payload)
        .catch((err) => console.error(`Trace failed (${langfuseTracer.name}):`, err)),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
