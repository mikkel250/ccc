/**
 * LangSmith run tracing — one of two tracer adapters dispatched from `tracers/index.ts`.
 *
 * Opt-in: LANGSMITH_TRACING=true and LANGSMITH_API_KEY.
 */
import { Client } from 'langsmith';
import type { Tracer, TracePayload } from './tracer';

let client: Client | null = null;

function initLangSmith(): Client | null {
  if (!client && process.env.LANGSMITH_API_KEY) {
    client = new Client({
      apiKey: process.env.LANGSMITH_API_KEY,
      apiUrl: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com',
      workspaceId: process.env.LANGSMITH_WORKSPACE_ID,
    });
  }
  return client;
}

function isEnabled(): boolean {
  return process.env.LANGSMITH_TRACING === 'true';
}

async function record(payload: TracePayload): Promise<void> {
  if (!isEnabled()) return;

  const { provider, model, messages, systemPrompt, response, startTime, options } = payload;

  try {
    const smithClient = initLangSmith();
    if (!smithClient) {
      console.log('LangSmith client not initialized!');
      return;
    }

    const durationMs = Date.now() - startTime;

    const traceData = {
      name: `llm_call_${provider}_${model}`,
      project_name: process.env.LANGSMITH_PROJECT_NAME,
      run_type: 'chain',
      inputs: {
        provider,
        model,
        messages,
        system_prompt: systemPrompt,
        options,
      },
      outputs: {
        content: response.content,
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
