/**
 * Lazy Langfuse OpenTelemetry bootstrap (Node.js API routes only).
 * Started once when LANGFUSE_TRACING=true and keys are set.
 */

import type { LangfuseSpanProcessor } from "@langfuse/otel";
import { getEnvNumber } from "../../../lib/env";

let otelStarted = false;
let otelStarting: Promise<void> | null = null;
let spanProcessor: LangfuseSpanProcessor | null = null;

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
    try {
      const { NodeSDK } = await import("@opentelemetry/sdk-node");
      const { LangfuseSpanProcessor } = await import("@langfuse/otel");

      spanProcessor = new LangfuseSpanProcessor({
        // Next.js API routes are short-lived — batched export often never flushes
        exportMode: "immediate",
        baseUrl: process.env.LANGFUSE_BASE_URL,
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
      });

      const sdk = new NodeSDK({
        spanProcessors: [spanProcessor],
      });

      sdk.start();
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

const DEFAULT_FLUSH_TIMEOUT_MS = 5000;

function flushWithTimeout(processor: LangfuseSpanProcessor, timeoutMs: number): Promise<void> {
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

  const timeoutMs = Math.max(
    1,
    Math.floor(getEnvNumber("LANGFUSE_FLUSH_TIMEOUT_MS", DEFAULT_FLUSH_TIMEOUT_MS))
  );

  try {
    await flushWithTimeout(spanProcessor, timeoutMs);
  } catch (error) {
    console.warn("Langfuse flush failed or timed out:", error);
  }
}
