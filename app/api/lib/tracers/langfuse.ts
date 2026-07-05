/**
 * Langfuse generation tracing — one of two tracer adapters dispatched from `tracers/index.ts`.
 *
 * Links each LLM call to prompt versions and usage. Requires LANGFUSE_TRACING=true
 * and keys; pairs with langfuse-otel.ts for span export.
 */
import { LangfuseClient } from '@langfuse/client';
import {
  startActiveObservation,
  type LangfuseGeneration,
} from '@langfuse/tracing';
import { ensureLangfuseOtel, flushLangfuseTraces } from '../langfuse-otel';
import type { Tracer, TracePayload } from './tracer';

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
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
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

async function record(payload: TracePayload): Promise<void> {
  if (!isEnabled()) return;

  const { provider, model, messages, systemPrompt, response, startTime, options, langfusePrompt } = payload;

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

    const durationMs = Date.now() - startTime;
    const modelParameters: Record<string, string | number> = {};
    if (typeof options.temperature === 'number') {
      modelParameters.temperature = options.temperature;
    }
    if (typeof options.maxTokens === 'number') {
      modelParameters.maxTokens = options.maxTokens;
    }

    await startActiveObservation(
      `llm_call_${provider}_${model}`,
      async (generation: LangfuseGeneration) => {
        generation.update({
          input: {
            provider,
            model,
            messages,
            system_prompt: systemPrompt,
            options,
          },
          output: {
            content: response.content,
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
          ...(Object.keys(modelParameters).length > 0
            ? { modelParameters }
            : {}),
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
        });
      },
      { asType: 'generation' }
    );

    await flushLangfuseTraces();
  } catch (error) {
    console.error('Langfuse trace failed:', error);
  }
}

export const langfuseTracer: Tracer = {
  name: 'langfuse',
  isEnabled,
  record,
};
