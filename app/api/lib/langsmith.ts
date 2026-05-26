import { Client } from 'langsmith';
import { ChatMessage, ChatResponse } from './llm';

let client: Client | null = null;

export function initLangSmith(): Client | null {
  if (!client && process.env.LANGSMITH_API_KEY) {
    client = new Client({
      apiKey: process.env.LANGSMITH_API_KEY,
      apiUrl: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com',
      workspaceId: process.env.LANGSMITH_WORKSPACE_ID,
    });
  }
  return client;
}

export async function traceLLMCall(
  provider: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  response: ChatResponse,
  startTime: number,
  options: any = {}
): Promise<void> {
  try {
    if (!process.env.LANGSMITH_TRACING || process.env.LANGSMITH_TRACING !== 'true') {
      return; // disable tracing
    }

    const client = initLangSmith();
    if (!client) {
      console.log('LangSmith client not initialized!');
      return;
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // create trace data
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
        duration_ms: duration,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      },
      tags: ['llm', provider, model],
    };

    // submit to LangSmith
    await client.createRun(traceData);
    console.log(`Langsmith trace submitted for ${provider}/${model}`);
  } catch (error) {
    // let the request go through even if tracing fails
    console.error('LangSmith trace failed:', error);
  }
}

// wrapper for the LLM chat function
export async function traceableChat(
  originalChat: Function,
  messages: ChatMessage[],
  systemPrompt: string,
  options: any = {},
  provider: string = 'unknown',
  model: string = 'unknown'
): Promise<ChatResponse> {
  const startTime = Date.now();
  const response = await originalChat(messages, systemPrompt, options);

  // trace the call async (no await to avoid slowing down the actual response)
  traceLLMCall(provider, model, messages, systemPrompt, response, startTime, options)
  .catch(err => console.error('Tracing Error:', err));

  return response;
}