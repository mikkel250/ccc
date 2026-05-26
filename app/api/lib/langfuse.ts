import { LangfuseClient } from '@langfuse/client';
import {
  startActiveObservation,
  type LangfuseGeneration,
} from '@langfuse/tracing';
import { ensureLangfuseOtel, flushLangfuseTraces } from './langfuse-otel';
import { ChatMessage, ChatOptions, ChatResponse } from './llm';

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

export async function traceLLMCall(
  provider: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  response: ChatResponse,
  startTime: number,
  options: ChatOptions | Record<string, unknown> = {},
  langfusePrompt?: LangfusePromptRef | null
): Promise<void> {
  try {
    if (process.env.LANGFUSE_TRACING !== 'true') {
      return;
    }

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
    const opts = options as ChatOptions & Record<string, unknown>;
    if (typeof opts.temperature === 'number') {
      modelParameters.temperature = opts.temperature;
    }
    if (typeof opts.maxTokens === 'number') {
      modelParameters.maxTokens = opts.maxTokens;
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
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            ...(opts.source ? { source: opts.source } : {}),
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

export async function traceableChat(
  originalChat: Function,
  messages: ChatMessage[],
  systemPrompt: string,
  options: ChatOptions | Record<string, unknown> = {},
  provider = 'unknown',
  model = 'unknown'
): Promise<ChatResponse> {
  const startTime = Date.now();
  const response = await originalChat(messages, systemPrompt, options);

  traceLLMCall(
    provider,
    model,
    messages,
    systemPrompt,
    response,
    startTime,
    options
  ).catch((err) => console.error('Langfuse tracing error:', err));

  return response;
}
