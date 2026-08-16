/**
 * Multi-provider LLM client — single entry point for every LLM call in this repo.
 *
 * Production CV generation (`tailor-cv/route.ts`), eval scripts, and future routes
 * all call `chat()`. Routing is config-driven: model strings are `provider/model`,
 * `detectProvider()` picks the integration, `dispatchProvider()` calls it.
 * Every successful or failed call is traced to LangSmith and Langfuse.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { recordLangSmithTrace, recordLangfuseTrace, type LangfusePromptRef } from './tracers';
import { toTraceOptions, type TracePayload } from './tracers/tracer';
import { getDeepSeekBaseUrl, getEnvNumber, getLLMConfig, getDefaultLlmModel, truncateSafeLogDetail } from '../../../lib/env';
import type { ReasoningEffort } from '../../../lib/env';
import { KNOWN_PROVIDERS, type Provider } from '../../../lib/providers';
import anthropicModels from '../../../config/anthropic-models.json';

// Re-exported for backward compatibility — llm.ts was the historical home of
// the provider registry; see lib/providers.ts for why it moved to a leaf module.
export { KNOWN_PROVIDERS, type Provider };

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

/**
 * Minimal OpenAI-compatible chat.completions.create seam used by callOpenAI /
 * callOpenRouter / callDeepSeek. Response is unknown so callers narrow safely.
 */
export interface OpenAICompatibleChatClient {
  chat: {
    completions: {
      create(
        body: {
          model: string;
          messages: ChatMessage[];
          temperature: number;
          max_tokens: number;
          [key: string]: unknown;
        },
        requestOptions?: { signal?: AbortSignal }
      ): Promise<unknown>;
    };
  };
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  source?: string;
  langfusePrompt?: LangfusePromptRef | null;
  /** OpenRouter flex pricing tier (default true). No effect on direct providers. */
  openRouterFlex?: boolean;
  /**
   * Explicit reasoning effort. When set, OpenRouter gets `reasoning.effort`;
   * DeepSeek direct gets `thinking` + `reasoning_effort` (mapped). Unset = provider default.
   */
  reasoningEffort?: ReasoningEffort;
  /** Abort signal for bounded LLM calls (judge/revise deadlines). */
  signal?: AbortSignal;
  /** Test-only: inject OpenAI client */
  openaiClient?: OpenAI;
  /** Test-only: inject OpenRouter client */
  openRouterClient?: OpenAI;
  /** Test-only: inject DeepSeek client */
  deepseekClient?: OpenAI;
  /** Test-only: inject Anthropic client */
  anthropicClient?: Anthropic;
  /** Test-only: inject Google client */
  googleClient?: GoogleGenAI;
}

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

function getGoogle(options?: ChatOptions): GoogleGenAI {
  if (options?.googleClient) {
    return options.googleClient;
  }
  if (!googleClient) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured');
    }
    googleClient = new GoogleGenAI({ apiKey });
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
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }
    deepseekClient = new OpenAI({
      apiKey,
      baseURL: getDeepSeekBaseUrl(),
    });
  }
  return deepseekClient;
}

/**
 * Detect provider from a namespaced model string (provider/model).
 * The first slash-delimited segment must be a known provider.
 */
export function detectProvider(model: string): Provider {
  const slash = model.indexOf('/');
  if (slash === -1) {
    throw new Error(`Invalid model string "${model}": must be namespaced as provider/model`);
  }
  const providerSegment = model.slice(0, slash);
  if (!KNOWN_PROVIDERS.has(providerSegment as Provider)) {
    throw new Error(`Unknown provider "${providerSegment}" in model "${model}"`);
  }
  return providerSegment as Provider;
}

/** Strip the provider prefix before passing model to a provider integration function. */
function stripProviderPrefix(model: string, provider: Provider): string {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
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

/**
 * Shared OpenAI-compatible call. All three OpenAI-shape providers (OpenAI,
 * OpenRouter, DeepSeek) hit `client.chat.completions.create` with the same
 * body shape and normalize the same response fields. The deltas are entirely
 * (a) which client to use, (b) which label to attach to the "no response"
 * error message, and (c) whether to append `service_tier`.
 *
 * Keeping the three public functions as thin wrappers preserves their
 * external signatures (used by tests and internal dispatchers).
 */
async function callOpenAICompatible(options: {
  client: OpenAICompatibleChatClient;
  providerLabel: string;
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[];
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  extraCreateParams?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<ChatResponse> {
  const {
    client,
    providerLabel,
    messages,
    systemPrompt,
    model,
    temperature,
    maxTokens,
    extraCreateParams,
    signal,
  } = options;
  const formattedMessages = formatMessages(messages);
  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...formattedMessages,
  ];

  const response: unknown = await client.chat.completions.create(
    {
      model,
      messages: fullMessages,
      temperature,
      max_tokens: maxTokens,
      ...extraCreateParams,
    },
    signal ? { signal } : undefined,
  );

  // OpenRouter (and some gateway proxies) can return 200-shaped bodies without
  // `choices` — e.g. flex/model errors embedded as `{ error: ... }`. Guard so
  // we throw a clear provider error instead of TypeError on `choices[0]`.
  const choice = openAICompatibleChoice(response);
  const content = choice?.message?.content;
  if (
    !choice?.message ||
    typeof content !== "string" ||
    content.length === 0
  ) {
    throw new Error(
      `No response from ${providerLabel}${embeddedOpenAICompatibleError(response)}`
    );
  }

  const usage = openAICompatibleUsage(response);
  const modelName = openAICompatibleModel(response);

  return {
    content,
    usage: {
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    },
    model: modelName,
    finishReason:
      typeof choice.finish_reason === "string" ? choice.finish_reason : null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function embeddedOpenAICompatibleError(response: unknown): string {
  if (!isPlainObject(response) || !("error" in response)) {
    return "";
  }
  try {
    const raw = JSON.stringify(response.error);
    return ` — ${truncateSafeLogDetail(raw)}`;
  } catch {
    return " — [provider error]";
  }
}

function openAICompatibleChoice(
  response: unknown
):
  | {
      message?: { content?: unknown };
      finish_reason?: unknown;
    }
  | undefined {
  if (!isPlainObject(response) || !Array.isArray(response.choices)) {
    return undefined;
  }
  const choice = response.choices[0];
  if (!isPlainObject(choice)) {
    return undefined;
  }
  const message = choice.message;
  return {
    message: isPlainObject(message)
      ? { content: message.content }
      : undefined,
    finish_reason: choice.finish_reason,
  };
}

function openAICompatibleUsage(
  response: unknown
):
  | {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    }
  | undefined {
  if (!isPlainObject(response) || !isPlainObject(response.usage)) {
    return undefined;
  }
  const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
  return {
    prompt_tokens: typeof prompt_tokens === "number" ? prompt_tokens : undefined,
    completion_tokens:
      typeof completion_tokens === "number" ? completion_tokens : undefined,
    total_tokens: typeof total_tokens === "number" ? total_tokens : undefined,
  };
}

function openAICompatibleModel(response: unknown): string {
  if (!isPlainObject(response) || typeof response.model !== "string") {
    return "";
  }
  return response.model;
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
    model,
  } = options;

  if (!model) throw new Error('model is required for callOpenAI');

  return callOpenAICompatible({
    client: getOpenAI(options),
    providerLabel: 'OpenAI',
    messages,
    systemPrompt,
    model,
    temperature,
    maxTokens,
    signal: options.signal,
  });
}

/**
 * OpenRouter unified reasoning param. Unset effort → omit (provider default).
 * @see https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
 */
export function buildOpenRouterReasoningParams(
  effort: ReasoningEffort | undefined
): { reasoning: { effort: ReasoningEffort } } | undefined {
  if (!effort) return undefined;
  return { reasoning: { effort } };
}

/**
 * DeepSeek direct API thinking controls.
 * Direct API only supports thinking on/off + reasoning_effort high|max.
 * OpenRouter-style medium/low/minimal map to high; xhigh/max → max; none → disabled.
 */
export function buildDeepSeekThinkingParams(
  effort: ReasoningEffort | undefined
):
  | { thinking: { type: "disabled" } }
  | { thinking: { type: "enabled" }; reasoning_effort: "high" | "max" }
  | undefined {
  if (!effort) return undefined;
  if (effort === "none") {
    return { thinking: { type: "disabled" } };
  }
  if (effort === "xhigh" || effort === "max") {
    return { thinking: { type: "enabled" }, reasoning_effort: "max" };
  }
  return { thinking: { type: "enabled" }, reasoning_effort: "high" };
}

export async function callOpenRouter(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {},
  clientOverride?: OpenAICompatibleChatClient
): Promise<ChatResponse> {
  const {
    maxTokens: defaultMaxTokens,
    temperature: defaultTemperature,
    openRouterFlex: defaultOpenRouterFlex,
  } = getLLMConfig();
  const {
    temperature = defaultTemperature,
    maxTokens = defaultMaxTokens,
    model,
    openRouterFlex = defaultOpenRouterFlex,
    reasoningEffort,
  } = options;

  if (!model) throw new Error('model is required for callOpenRouter');

  const extraCreateParams: Record<string, unknown> = {
    ...(openRouterFlex ? { service_tier: 'flex' as const } : {}),
    ...buildOpenRouterReasoningParams(reasoningEffort),
  };

  return callOpenAICompatible({
    client: clientOverride ?? getOpenRouter(options),
    providerLabel: 'OpenRouter',
    messages,
    systemPrompt,
    model,
    temperature,
    maxTokens,
    extraCreateParams:
      Object.keys(extraCreateParams).length > 0 ? extraCreateParams : undefined,
    signal: options.signal,
  });
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
    model,
    reasoningEffort,
  } = options;

  if (!model) throw new Error('model is required for callDeepSeek');

  // Sole strip site for deepseek (dispatchProvider skips it for this provider —
  // see the comment there) since callDeepSeek is also invoked directly from
  // tests where the prefix may still be present.
  const apiModel = stripProviderPrefix(model, 'deepseek');

  return callOpenAICompatible({
    client: getDeepSeek(options),
    providerLabel: 'DeepSeek',
    messages,
    systemPrompt,
    model: apiModel,
    temperature,
    maxTokens,
    extraCreateParams: buildDeepSeekThinkingParams(reasoningEffort),
    signal: options.signal,
  });
}

type AnthropicModelAlias = keyof typeof anthropicModels;

function isAnthropicAlias(s: string): s is AnthropicModelAlias {
  return s in anthropicModels;
}

/** Is the model string already a versioned ID that needs no resolution? */
function isVersionedModelId(model: string): boolean {
  return /\d{6,}|\d+\.\d+|\bclaude-\d|\bclaude-[a-z]+-\d/.test(model);
}

function detectAnthropicFamily(model: string): AnthropicModelAlias | null {
  const lower = model.toLowerCase();
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

const resolvedModelCache = new Map<AnthropicModelAlias, { id: string; ts: number }>();

function pickVersionedAnthropicModelId(
  family: AnthropicModelAlias,
  discoveredIds: string[],
): string | null {
  const pinned = anthropicModels[family];
  const versioned = discoveredIds.filter(
    (id) => id.includes(family) && isVersionedModelId(id),
  );
  if (versioned.includes(pinned)) return pinned;
  if (versioned.length === 0) return null;
  return versioned.sort((a, b) => b.length - a.length)[0];
}

async function resolveLatestModelId(
  family: AnthropicModelAlias,
  client: Anthropic,
): Promise<string> {
  const cacheTtlMs = getEnvNumber('ANTHROPIC_MODEL_CACHE_TTL_MS', 7 * 24 * 60 * 60 * 1000);
  const cached = resolvedModelCache.get(family);
  if (cached && Date.now() - cached.ts < cacheTtlMs) return cached.id;

  try {
    const page = await client.models.list();
    const resolved = pickVersionedAnthropicModelId(
      family,
      page.data.map((m) => m.id),
    );
    if (resolved) {
      resolvedModelCache.set(family, { id: resolved, ts: Date.now() });
      return resolved;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Anthropic models.list() failed for family "${family}"; using ${cached ? 'stale cache' : 'pinned fallback'}. Reason: ${message}`,
    );
  }

  if (cached) return cached.id;
  return anthropicModels[family];
}

/** Internal to callAnthropic: strips anthropic/ prefix and resolves aliases to versioned IDs. */
async function normalizeAnthropicModel(
  model: string,
  client: Anthropic,
): Promise<string> {
  const cleaned = model.replace(/^anthropic\//, '');
  if (isVersionedModelId(cleaned)) return cleaned;

  if (isAnthropicAlias(cleaned)) return resolveLatestModelId(cleaned, client);

  const family = detectAnthropicFamily(cleaned);
  if (family) return resolveLatestModelId(family, client);

  return cleaned;
}

export async function callAnthropic(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const { maxTokens: defaultMaxTokens, temperature: defaultTemperature } = getLLMConfig();
  const { temperature = defaultTemperature, maxTokens = defaultMaxTokens, model: rawModel } = options;

  if (!rawModel) throw new Error('model is required for callAnthropic');

  const anthropic = getAnthropic(options);
  const model = await normalizeAnthropicModel(rawModel, anthropic);

  const formattedMessages = formatMessages(messages);
  const claudeMessages = formattedMessages
    .filter(msg => msg.role !== 'system')
    .map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

  const response = await anthropic.messages.create(
    {
      model,
      system: systemPrompt,
      messages: claudeMessages,
      temperature,
      max_tokens: maxTokens,
    },
    options.signal ? { signal: options.signal } : undefined,
  );

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
  const { temperature = defaultTemperature, maxTokens = defaultMaxTokens, model } = options;

  if (!model) throw new Error('model is required for callGoogle');

  const formattedMessages = formatMessages(messages);
  const contents = formattedMessages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const response = await getGoogle(options).models.generateContent({
    model: model,
    contents,
    config: {
      systemInstruction: systemPrompt,
      temperature,
      maxOutputTokens: maxTokens,
      ...(options.signal ? { abortSignal: options.signal } : {}),
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

/** Routes to the provider-specific API integration. Adding a provider = new case + env key, not routing if-chains elsewhere. */
export async function dispatchProvider(
  provider: Provider,
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions
): Promise<ChatResponse> {
  // deepseek is excluded here — callDeepSeek strips its own prefix (tests call
  // it directly with a prefixed model string), so stripping here too would be
  // a redundant double-strip. Every other provider strips only at dispatch.
  const strippedModel =
    options.model && provider !== 'deepseek'
      ? stripProviderPrefix(options.model, provider)
      : options.model;
  const strippedOptions = { ...options, model: strippedModel };

  switch (provider) {
    case 'openai':
      return await callOpenAI(messages, systemPrompt, strippedOptions);
    case 'openrouter':
      return await callOpenRouter(messages, systemPrompt, strippedOptions, options.openRouterClient);
    case 'anthropic':
      return await callAnthropic(messages, systemPrompt, strippedOptions);
    case 'google':
      return await callGoogle(messages, systemPrompt, strippedOptions);
    case 'deepseek':
      return await callDeepSeek(messages, systemPrompt, strippedOptions);
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

function buildLlmTracePayload(params: {
  provider: Provider;
  model: string;
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[];
  systemPrompt: string;
  response: ChatResponse;
  startTime: number;
  options: ChatOptions;
}): TracePayload {
  return {
    provider: params.provider,
    model: params.model,
    messages: formatMessages(params.messages),
    systemPrompt: params.systemPrompt,
    response: params.response,
    startTime: params.startTime,
    options: toTraceOptions(params.options),
    langfusePrompt: params.options.langfusePrompt ?? null,
  };
}

/**
 * Central entry for all LLM chat completions. Resolves model from options or AI_MODEL,
 * dispatches to the correct provider integration, and records traces for observability.
 */
export async function chat(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const model = options.model || getDefaultLlmModel();
  const provider = detectProvider(model);
  const startTime = Date.now();

  console.log(`LLM dispatch: ${model} (${provider})`);

  try {
    const response = await dispatchProvider(provider, messages, systemPrompt, {
      ...options,
      model,
    });

    const tracePayload = buildLlmTracePayload({
      provider,
      model,
      messages,
      systemPrompt,
      response,
      startTime,
      options,
    });

    recordLangSmithTrace(tracePayload);
    await recordLangfuseTrace(tracePayload);

    return response;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`${provider} failed:`, errorMessage);

    const errorResponse: ChatResponse = {
      content: `Error: ${errorMessage}`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model,
      finishReason: null,
    };

    const tracePayload = buildLlmTracePayload({
      provider,
      model,
      messages,
      systemPrompt,
      response: errorResponse,
      startTime,
      options,
    });

    // LangSmith trace is fire-and-forget (matches success path).
    recordLangSmithTrace(tracePayload);

    // Langfuse trace MUST be awaited so `flushLangfuseTraces()` (exportMode: "immediate")
    // completes before the serverless container is frozen. Without the await, error
    // traces vanish on cold-start containers even though the success path persists them.
    await recordLangfuseTrace(tracePayload);

    throw error;
  }
}

export async function testConnection(): Promise<boolean> {
  const defaultModel = getDefaultLlmModel();
  const provider = detectProvider(defaultModel);

  try {
    switch (provider) {
      case 'openrouter':
        if (!process.env.OPENROUTER_API_KEY) return false;
        await getOpenRouter().models.list();
        return true;
      case 'openai':
        if (!process.env.OPENAI_API_KEY) return false;
        await getOpenAI().models.list();
        return true;
      case 'anthropic':
        if (!process.env.ANTHROPIC_API_KEY) return false;
        await getAnthropic().models.list();
        return true;
      case 'deepseek':
        if (!process.env.DEEPSEEK_API_KEY) return false;
        return true;
      case 'google':
        if (!process.env.GOOGLE_API_KEY) return false;
        await getGoogle().models.list();
        return true;
      default:
        if (process.env.OPENROUTER_API_KEY) {
          await getOpenRouter().models.list();
          return true;
        }
        if (process.env.OPENAI_API_KEY) {
          await getOpenAI().models.list();
          return true;
        }
        return false;
    }
  } catch (error) {
    console.error('LLM connection test failed:', error);
    return false;
  }
}
