import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { traceLLMCall } from './langsmith';
import { traceLLMCall as traceLLMCallLangFuse, type LangfusePromptRef } from './langfuse';

// Configuration helper
function getLLMConfig() {
  const maxTokens = process.env.AI_MAX_TOKENS
    ? parseInt(process.env.AI_MAX_TOKENS, 10)
    : 8192;

  const temperature = process.env.AI_TEMPERATURE
    ? parseFloat(process.env.AI_TEMPERATURE)
    : 0.3;

  return { maxTokens, temperature };
}

export const LLM_CONFIG = getLLMConfig();

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: string | null;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  source?: string;
  langfusePrompt?: LangfusePromptRef | null;
  /** Test-only: inject OpenAI client */
  openaiClient?: OpenAI;
  /** Test-only: inject OpenRouter client */
  openRouterClient?: OpenAI;
}

export type Provider = 'openai' | 'anthropic' | 'google' | 'openrouter';

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let googleClient: GoogleGenAI | null = null;
let openrouterClient: OpenAI | null = null;

function getOpenAI(options?: ChatOptions): OpenAI {
  if (options?.openaiClient) {
    return options.openaiClient;
  }
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function getGoogle(): GoogleGenAI {
  if (!googleClient) {
    googleClient = new GoogleGenAI({
      apiKey: process.env.GOOGLE_API_KEY || '',
    });
  }
  return googleClient;
}

function getOpenRouter(options?: ChatOptions): OpenAI {
  if (options?.openRouterClient) {
    return options.openRouterClient;
  }
  if (!openrouterClient) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured');
    }
    openrouterClient = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
  }
  return openrouterClient;
}

/** OpenRouter models use provider/model (e.g. openai/gpt-4o). */
export function detectProvider(model: string): Provider {
  if (model.includes('/')) {
    return 'openrouter';
  }

  const modelToLower = model.toLowerCase();

  if (modelToLower.includes('claude')) {
    return 'anthropic';
  }

  if (modelToLower.includes('gemini')) {
    return 'google';
  }

  return 'openai';
}

function formatMessages(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[]
): ChatMessage[] {
  return messages.map((msg) => {
    if (typeof msg === 'string') {
      return { role: 'user', content: msg };
    }
    if ('role' in msg && 'content' in msg) {
      return msg as ChatMessage;
    }
    return { role: 'user', content: (msg as { content?: string }).content || String(msg) };
  });
}

async function callOpenAI(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const { maxTokens: defaultMaxTokens, temperature: defaultTemperature } = getLLMConfig();
  const {
    temperature = defaultTemperature,
    maxTokens = defaultMaxTokens,
    model = process.env.AI_MODEL || 'gpt-4o-mini',
  } = options;

  const formattedMessages = formatMessages(messages);
  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...formattedMessages,
  ];

  const response = await getOpenAI(options).chat.completions.create({
    model,
    messages: fullMessages,
    temperature,
    max_tokens: maxTokens,
  });

  const choice = response.choices[0];
  if (!choice || !choice.message) {
    throw new Error('No response from OpenAI');
  }

  return {
    content: choice.message.content || '',
    usage: {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    },
    model: response.model,
    finishReason: choice.finish_reason,
  };
}

export async function callOpenRouter(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {},
  clientOverride?: OpenAI
): Promise<ChatResponse> {
  const { maxTokens: defaultMaxTokens, temperature: defaultTemperature } = getLLMConfig();
  const {
    temperature = defaultTemperature,
    maxTokens = defaultMaxTokens,
    model = process.env.AI_MODEL || 'openai/gpt-4o-mini',
  } = options;

  const formattedMessages = formatMessages(messages);
  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...formattedMessages,
  ];

  const client = clientOverride ?? getOpenRouter(options);
  const response = await client.chat.completions.create({
    model,
    messages: fullMessages,
    temperature,
    max_tokens: maxTokens,
  });

  const choice = response.choices[0];
  if (!choice || !choice.message) {
    throw new Error('No response from OpenRouter');
  }

  return {
    content: choice.message.content || '',
    usage: {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    },
    model: response.model,
    finishReason: choice.finish_reason,
  };
}

async function callAnthropic(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions
): Promise<ChatResponse> {
  const { maxTokens: defaultMaxTokens, temperature: defaultTemperature } = getLLMConfig();
  const { temperature = defaultTemperature, maxTokens = defaultMaxTokens, model = 'claude-haiku-4-5-20251001' } = options;

  const formattedMessages = formatMessages(messages);
  const claudeMessages = formattedMessages
    .filter(msg => msg.role !== 'system')
    .map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

  const response = await getAnthropic().messages.create({
    model,
    system: systemPrompt,
    messages: claudeMessages,
    temperature,
    max_tokens: maxTokens,
  });

  const textContent = response.content.find(block => block.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude!');
  }

  return {
    content: textContent.text,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
    model: response.model,
    finishReason: response.stop_reason,
  };
}

async function callGoogle(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions
): Promise<ChatResponse> {
  const { maxTokens: defaultMaxTokens, temperature: defaultTemperature } = getLLMConfig();
  const { temperature = defaultTemperature, maxTokens = defaultMaxTokens, model = 'gemini-2.5-pro' } = options;

  const formattedMessages = formatMessages(messages);

  let fullPrompt = `${systemPrompt}\n\n---\n\nConversation History:\n`;

  for (let i = 0; i < formattedMessages.length - 1; i++) {
    const msg = formattedMessages[i];
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    fullPrompt += `${role}: ${msg.content}\n\n`;
  }

  fullPrompt += `User: ${formattedMessages[formattedMessages.length - 1]?.content || ''}`;

  const response = await getGoogle().models.generateContent({
    model: model,
    contents: fullPrompt,
    config: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  });

  const content = response.text;
  if (!content) {
    console.log('Response structure:', JSON.stringify(response, null, 2));
    throw new Error('No text content in response from Google');
  }

  const usage = (response as { usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }).usage || {};

  return {
    content,
    usage: {
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      totalTokens: usage.totalTokens || (usage.promptTokens || 0) + (usage.completionTokens || 0),
    },
    model: model,
    finishReason: (response as { finishReason?: string | null }).finishReason || null,
  };
}

export async function dispatchProvider(
  provider: Provider,
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions
): Promise<ChatResponse> {
  switch (provider) {
    case 'openai':
      return await callOpenAI(messages, systemPrompt, options);
    case 'openrouter':
      return await callOpenRouter(messages, systemPrompt, options, options.openRouterClient);
    case 'anthropic':
      return await callAnthropic(messages, systemPrompt, options);
    case 'google':
      return await callGoogle(messages, systemPrompt, options);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

export function isLlmServiceError(message: string): boolean {
  return (
    message.includes('OpenAI') ||
    message.includes('Anthropic') ||
    message.includes('Google') ||
    message.includes('OpenRouter') ||
    message.includes('OPENROUTER_API_KEY') ||
    message.includes('quota') ||
    message.includes('RESOURCE_EXHAUSTED')
  );
}

export async function chat(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const model = options.model || process.env.AI_MODEL || 'gemini-2.5-flash';
  const provider = detectProvider(model);
  const startTime = Date.now();

  console.log(`LLM dispatch: ${model} (${provider})`);

  try {
    const response = await dispatchProvider(provider, messages, systemPrompt, {
      ...options,
      model,
    });

    traceLLMCall(provider, model, messages as ChatMessage[], systemPrompt, response, startTime, options)
      .catch(err => console.error('Tracing error (LangSmith):', err));
    await traceLLMCallLangFuse(
      provider,
      model,
      messages as ChatMessage[],
      systemPrompt,
      response,
      startTime,
      options,
      options.langfusePrompt ?? null
    ).catch(err => console.error('Tracing error (Langfuse):', err));

    logUsage(provider, model, response.usage.totalTokens);

    return response;
  } catch (error: unknown) {
    const err = error as { message?: string };
    const errorMessage = err.message || 'Unknown error';
    console.log(`${provider} failed:`, errorMessage);

    traceLLMCall(provider, model, messages as ChatMessage[], systemPrompt, {
      content: `Error: ${errorMessage}`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model,
      finishReason: null,
    } as ChatResponse, startTime, options)
      .catch(traceErr => console.error('Tracing error (LangSmith):', traceErr));
    traceLLMCallLangFuse(provider, model, messages as ChatMessage[], systemPrompt, {
      content: `Error: ${errorMessage}`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model,
      finishReason: null,
    } as ChatResponse, startTime, options)
      .catch(traceErr => console.error('Tracing error (Langfuse):', traceErr));

    throw error;
  }
}

export interface UsageStats {
  provider: string;
  model: string;
  tokens: number;
  cost: number;
  timestamp: Date;
}

const COST_PER_1K_TOKENS: Record<string, number> = {
  'gemini-2.5-flash': 0.0,
  'gemini-2.5-pro': 0.0,
  'claude-haiku-4-5-20251001': 0.00025,
  'gpt-4o': 0.005,
  'gpt-4o-mini': 0.00015,
};

function calculateCost(model: string, tokens: number): number {
  const costPer1K = COST_PER_1K_TOKENS[model] || 0.001;
  return (tokens / 1000) * costPer1K;
}

function logUsage(provider: string, model: string, tokens: number): void {
  const cost = calculateCost(model, tokens);
  console.log(`Usage: ${provider} (${model}) - ${tokens} tokens - $${cost.toFixed(4)}`);
}

export async function testConnection(): Promise<boolean> {
  try {
    if (process.env.OPENROUTER_API_KEY) {
      await getOpenRouter().models.list();
      return true;
    }
    await getOpenAI().models.list();
    return true;
  } catch (error) {
    console.error('LLM connection test failed:', error);
    return false;
  }
}
