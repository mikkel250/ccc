/**
 * LangSmith run tracing — one of two tracer adapters dispatched from `tracers/index.ts`.
 *
 * Opt-in: LANGSMITH_TRACING=true and LANGSMITH_API_KEY.
 */
import { Client } from 'langsmith';
import { getEnvString } from '../../../../lib/env';
import type { Tracer, TracePayload } from './tracer';

const REDACTED = '[REDACTED]';

let client: Client | null = null;

function initLangSmith(): Client | null {
  const apiKey = getEnvString('LANGSMITH_API_KEY');
  if (!client && apiKey) {
    client = new Client({
      apiKey,
      apiUrl: getEnvString('LANGSMITH_ENDPOINT', 'https://api.smith.langchain.com')!,
      workspaceId: getEnvString('LANGSMITH_WORKSPACE_ID'),
    });
  }
  return client;
}

function isEnabled(): boolean {
  return getEnvString('LANGSMITH_TRACING') === 'true';
}

async function record(payload: TracePayload): Promise<void> {
  if (!isEnabled()) return;

  const { provider, model, response, startTime, options } = payload;

  try {
    const smithClient = initLangSmith();
    if (!smithClient) {
      console.log('LangSmith client not initialized!');
      return;
    }

    const durationMs = Date.now() - startTime;

    const traceData = {
      name: `llm_call_${provider}_${model}`,
      project_name: getEnvString('LANGSMITH_PROJECT_NAME'),
      run_type: 'chain',
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
      metadata: {
        provider,
        model,
        duration_ms: durationMs,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      },
      tags: ['llm', provider, model],
    };

    await smithClient.createRun(traceData);
    console.log(`Langsmith trace submitted for ${provider}/${model}`);
  } catch (error) {
    console.error('LangSmith trace failed:', error);
  }
}

export const langsmithTracer: Tracer = {
  name: 'langsmith',
  isEnabled,
  record,
};
