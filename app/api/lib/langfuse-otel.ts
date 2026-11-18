/**
 * Lazy Langfuse OpenTelemetry bootstrap (Node.js API routes only).
 * Started once when LANGFUSE_TRACING=true and keys are set.
 */

import { getEnvNumber } from "../../../lib/env";

type FlushableSpanProcessor = {
  forceFlush: () => Promise<void>;
};

let otelStarted = false;
let otelStarting: Promise<void> | null = null;
let spanProcessor: FlushableSpanProcessor | null = null;
let otelInitAttempts = 0;

export function __resetLangfuseOtelForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__resetLangfuseOtelForTest is only available in the test environment");
  }
  otelStarted = false;
  otelStarting = null;
  spanProcessor = null;
  otelInitAttempts = 0;
}

export function __getLangfuseOtelInitAttemptsForTest(): number {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "__getLangfuseOtelInitAttemptsForTest is only available in the test environment"
    );
  }
  return otelInitAttempts;
}

export function __injectLangfuseSpanProcessorForTest(
  processor: FlushableSpanProcessor | null
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "__injectLangfuseSpanProcessorForTest is only available in the test environment"
    );
  }
  spanProcessor = processor;
  otelStarted = processor !== null;
}

export async function ensureLangfuseOtel(): Promise<void> {
  if (otelStarted) return;

  if (process.env.LANGFUSE_TRACING !== "true") return;

  if (
    !process.env.LANGFUSE_PUBLIC_KEY?.trim() ||
    !process.env.LANGFUSE_SECRET_KEY?.trim()
  ) {
    return;
  }

  if (otelStarting) {
    await otelStarting;
    return;
  }

  otelStarting = (async () => {
    otelInitAttempts += 1;
    try {
      const { NodeSDK } = await import("@opentelemetry/sdk-node");
      const { LangfuseSpanProcessor } = await import("@langfuse/otel");

      const processor = new LangfuseSpanProcessor({
        // Next.js API routes are short-lived — batched export often never flushes
        exportMode: "immediate",
        baseUrl: process.env.LANGFUSE_BASE_URL,
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
      });
      spanProcessor = processor;

      const sdk = new NodeSDK({
        spanProcessors: [processor],
      });

      await sdk.start();
      otelStarted = true;
      console.log("Langfuse OTEL started (lazy, immediate export)");
    } catch (error) {
      console.warn("Langfuse OTEL failed to start:", error);
    } finally {
      otelStarting = null;
    }
  })();

  await otelStarting;
}

export const DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS = 5000;

export function getLangfuseFlushTimeoutMs(): number {
  return Math.max(
    1,
    Math.floor(getEnvNumber("LANGFUSE_FLUSH_TIMEOUT_MS", DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS))
  );
}

function flushWithTimeout(processor: FlushableSpanProcessor, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Langfuse flush timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    processor
      .forceFlush()
      .then(() => {
        clearTimeout(timer);
        resolve();
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/** Flush pending spans so they appear in Langfuse before the request ends. */
export async function flushLangfuseTraces(): Promise<void> {
  if (!spanProcessor) return;

  const timeoutMs = getLangfuseFlushTimeoutMs();

  try {
    await flushWithTimeout(spanProcessor, timeoutMs);
  } catch (error) {
    console.warn("Langfuse flush failed or timed out:", error);
  }
}
