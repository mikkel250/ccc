import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { traceLLMCall } from './langsmith';
import { traceLLMCall as traceLLMCallLangFuse, type LangfusePromptRef } from './langfuse';

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.3;
const MIN_MAX_TOKENS = 1;
const MAX_MAX_TOKENS = 128_000;

function parseMaxTokens(raw: string | undefined): number {
  if (!raw) return DEFAULT_MAX_TOKENS;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_MAX_TOKENS) {
    return DEFAULT_MAX_TOKENS;
  }
  return Math.min(Math.floor(parsed), MAX_MAX_TOKENS);
}

function parseTemperature(raw: string | undefined): number {
  if (!raw) return DEFAULT_TEMPERATURE;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TEMPERATURE;
  return Math.min(1, Math.max(0, parsed));
}

// Configuration helper
function getLLMConfig() {
  const maxTokens = parseMaxTokens(process.env.AI_MAX_TOKENS);
  const temperature = parseTemperature(process.env.AI_TEMPERATURE);
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
  /** OpenRouter flex pricing tier (default true). No effect on direct providers. */
  openRouterFlex?: boolean;
  /** Test-only: inject OpenAI client */
  openaiClient?: OpenAI;
  /** Test-only: inject OpenRouter client */
  openRouterClient?: OpenAI;
  /** Test-only: inject DeepSeek client */
  deepseekClient?: OpenAI;
  /** Test-only: inject Anthropic client */
  anthropicClient?: Anthropic;
}

export type Provider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'deepseek';

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let googleClient: GoogleGenAI | null = null;
let openrouterClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;

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

function getAnthropic(options?: ChatOptions): Anthropic {
  if (options?.anthropicClient) {
    return options.anthropicClient;
  }
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

function getDeepSeek(options?: ChatOptions): OpenAI {
  if (options?.deepseekClient) {
    return options.deepseekClient;
  }
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    });
  }
  return deepseekClient;
}

/** Slash-prefixed models (e.g. openai/gpt-4o) route through OpenRouter. Anthropic is excluded — uses direct API only. */
export function detectProvider(model: string): Provider {
  if (model.startsWith('anthropic/')) {
    return 'anthropic';
  }
  if (model.includes('/')) {
    return 'openrouter';
  }

  const modelToLower = model.toLowerCase();

  if (modelToLower.startsWith('deepseek-')) {
    return 'deepseek';
  }

  if (
    modelToLower === 'sonnet' ||
    modelToLower === 'opus' ||
    modelToLower === 'haiku' ||
    modelToLower.includes('claude')
  ) {
    return 'anthropic';
  }

  return 'openrouter';
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
    model = process.env.AI_MODEL || 'openai/gpt-5.4-mini',
    openRouterFlex = true,
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
    ...(openRouterFlex ? { service_tier: 'flex' as const } : {}),
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

export async function callDeepSeek(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const { maxTokens: defaultMaxTokens, temperature: defaultTemperature } = getLLMConfig();
  const {
    temperature = defaultTemperature,
    maxTokens = defaultMaxTokens,
    model = process.env.AI_MODEL || 'deepseek-v4-pro',
  } = options;

  const formattedMessages = formatMessages(messages);
  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...formattedMessages,
  ];

  const response = await getDeepSeek(options).chat.completions.create({
    model,
    messages: fullMessages,
    temperature,
    max_tokens: maxTokens,
  });

  const choice = response.choices[0];
  if (!choice || !choice.message) {
    throw new Error('No response from DeepSeek');
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

/** Static fallback used when the Models API is unreachable. */
const FALLBACK_ANTHROPIC_MODELS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
  haiku: 'claude-haiku-4-5',
};

type AnthropicModelFamily = 'sonnet' | 'opus' | 'haiku';

function detectAnthropicFamily(model: string): AnthropicModelFamily | null {
  const lower = model.toLowerCase();
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

/** Is the model string already a versioned ID that needs no resolution? */
function isVersionedModelId(model: string): boolean {
  return /\d{6,}|\d+\.\d+/.test(model);
}

// ---- Dynamic model resolution via the Anthropic Models API ----

const resolvedModelCache = new Map<AnthropicModelFamily, { id: string; ts: number }>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/**
 * Resolve a model family alias to the latest versioned model ID by querying
 * the Anthropic Models API. Results are cached for 1 hour. Falls back to
 * FALLBACK_ANTHROPIC_MODELS if the API is unreachable.
 */
async function resolveLatestModelId(
  family: AnthropicModelFamily,
  client: Anthropic,
): Promise<string> {
  const cached = resolvedModelCache.get(family);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.id;

  try {
    const page = await client.models.list();
    for (const m of page.data) {
      if (m.id.includes(family)) {
        resolvedModelCache.set(family, { id: m.id, ts: Date.now() });
        return m.id;
      }
    }
  } catch {
    // API unavailable — use stale cache if we have one, else fallback
  }

  if (cached) return cached.id;
  return FALLBACK_ANTHROPIC_MODELS[family];
}

/** Normalize a model alias to a versioned Anthropic model ID. */
async function normalizeAnthropicModel(
  model: string,
  client: Anthropic,
): Promise<string> {
  const lower = model.toLowerCase();

  // Already a versioned ID — pass through unchanged
  if (isVersionedModelId(model)) return model;

  // Detect family and resolve dynamically
  const family = detectAnthropicFamily(lower);
  if (family) return resolveLatestModelId(family, client);

  // Unrecognised alias — pass through and let the API reject it
  return model;
}

export async function callAnthropic(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const { maxTokens: defaultMaxTokens, temperature: defaultTemperature } = getLLMConfig();
  const { temperature = defaultTemperature, maxTokens = defaultMaxTokens, model: rawModel = 'sonnet' } = options;
  const anthropic = getAnthropic(options);
  const model = await normalizeAnthropicModel(rawModel, anthropic);

  const formattedMessages = formatMessages(messages);
  const claudeMessages = formattedMessages
    .filter(msg => msg.role !== 'system')
    .map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

  const response = await anthropic.messages.create({
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
    case 'deepseek':
      return await callDeepSeek(messages, systemPrompt, options);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

export function isLlmServiceError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('openai') ||
    m.includes('anthropic') ||
    m.includes('google') ||
    m.includes('openrouter') ||
    m.includes('deepseek') ||
    m.includes('openrouter_api_key') ||
    m.includes('deepseek_api_key') ||
    m.includes('quota') ||
    m.includes('resource_exhausted')
  );
}

export async function chat(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const model = options.model || process.env.AI_MODEL || 'openai/gpt-5.4-mini';
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
