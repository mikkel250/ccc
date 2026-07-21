/**
 * Langfuse generation tracing — one of two tracer adapters dispatched from `tracers/index.ts`.
 *
 * Links each LLM call to prompt versions and usage. Requires LANGFUSE_TRACING=true
 * and keys; pairs with langfuse-otel.ts for span export.
 *
 * Content (messages, system prompt, response body) is redacted to LangSmith parity
 * before export (R8b / KTD5) so master/curated CV PII never leaves the trust boundary.
 */
import { LangfuseClient } from '@langfuse/client';
import {
  startActiveObservation,
  type LangfuseGeneration,
} from '@langfuse/tracing';
import { getEnvString } from '../../../../lib/env';
import { ensureLangfuseOtel, flushLangfuseTraces } from '../langfuse-otel';
import type { Tracer, TracePayload } from './tracer';

const REDACTED = '[REDACTED]';

let langfuseClient: LangfuseClient | null = null;

export function initLangFuse(): LangfuseClient | null {
  if (
    !langfuseClient &&
    process.env.LANGFUSE_PUBLIC_KEY &&
    process.env.LANGFUSE_SECRET_KEY
  ) {
    langfuseClient = new LangfuseClient({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: getEnvString('LANGFUSE_BASE_URL', 'https://cloud.langfuse.com')!,
    });
  }
  return langfuseClient;
}

export interface LangfusePromptRef {
  name: string;
  version: number;
  isFallback?: boolean;
}

function isEnabled(): boolean {
  return process.env.LANGFUSE_TRACING === 'true';
}

/**
 * Build the Langfuse generation.update() payload with content redacted.
 * Exported for unit tests that assert no raw prompt/response substrings leak.
 */
export function buildLangfuseGenerationUpdate(payload: TracePayload): {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata: Record<string, unknown>;
  model: string;
  modelParameters?: Record<string, string | number>;
  usageDetails: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  prompt?: LangfusePromptRef;
} {
  const { provider, model, response, startTime, options, langfusePrompt } = payload;
  const durationMs = Date.now() - startTime;
  const modelParameters: Record<string, string | number> = {};
  if (typeof options.temperature === 'number') {
    modelParameters.temperature = options.temperature;
  }
  if (typeof options.maxTokens === 'number') {
    modelParameters.maxTokens = options.maxTokens;
  }

  return {
    input: {
      provider,
      model,
      messages: REDACTED,
      system_prompt: REDACTED,
      options,
    },
    output: {
      content: REDACTED,
      usage: response.usage,
    },
    metadata: {
      provider,
      model,
      duration_ms: durationMs,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      ...(options.source ? { source: options.source } : {}),
    },
    model,
    ...(Object.keys(modelParameters).length > 0 ? { modelParameters } : {}),
    usageDetails: {
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
    },
    ...(langfusePrompt
      ? {
          prompt: {
            name: langfusePrompt.name,
            version: langfusePrompt.version,
            isFallback: langfusePrompt.isFallback ?? false,
          },
        }
      : {}),
  };
}

async function record(payload: TracePayload): Promise<void> {
  if (!isEnabled()) return;

  const { provider, model } = payload;

  try {
    if (
      !process.env.LANGFUSE_PUBLIC_KEY?.trim() ||
      !process.env.LANGFUSE_SECRET_KEY?.trim()
    ) {
      console.warn('Langfuse tracing skipped: missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY');
      return;
    }

    await ensureLangfuseOtel();
    initLangFuse();

    const update = buildLangfuseGenerationUpdate(payload);

    await startActiveObservation(
      `llm_call_${provider}_${model}`,
      async (generation: LangfuseGeneration) => {
        generation.update(update);
      },
      { asType: 'generation' }
    );

    await flushLangfuseTraces();
  } catch (error) {
    // Do not log TracePayload bodies — they may contain master/curated CV text.
    console.error('Langfuse trace failed:', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export const langfuseTracer: Tracer = {
  name: 'langfuse',
  isEnabled,
  record,
};
