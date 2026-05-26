import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { traceLLMCall } from './langsmith';
import { traceLLMCall as traceLLMCallLangFuse, type LangfusePromptRef } from './langfuse';

// Configuration helper
function getLLMConfig() {
  // Parse max tokens from env (supports different values for different models)
  const maxTokens = process.env.AI_MAX_TOKENS 
    ? parseInt(process.env.AI_MAX_TOKENS, 10) 
    : 8192; // Default for Flash and most models
  
  // Temperature from env (defaults to lower for reduced hallucinations)
  const temperature = process.env.AI_TEMPERATURE 
    ? parseFloat(process.env.AI_TEMPERATURE) 
    : 0.3; // Lowered default to reduce hallucinations in Gemini Pro
  
  return { maxTokens, temperature };
}

// Export config helper for use in routes
export const LLM_CONFIG = getLLMConfig();

// Types for our chat interface
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
  /** Trace source endpoint, e.g. tailor-cv */
  source?: string;
  /** Optional Langfuse prompt info to link in traces */
  langfusePrompt?: LangfusePromptRef | null;
}

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let googleClient: GoogleGenAI | null = null;

function getOpenAI(): OpenAI {
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

// detect which provider to use based on model name 
type Provider = 'openai' | 'anthropic' | 'google';

function detectProvider(model: string): Provider {
  const modelToLower = model.toLowerCase();

  if (modelToLower.includes('claude')) {
    return 'anthropic';
  }

  if (modelToLower.includes('gemini')) {
    return 'google';
  }

  return 'openai';
}

async function callOpenAI(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {}
): Promise<ChatResponse> {
  // Default options from env or fallback values
  const { maxTokens: defaultMaxTokens, temperature: defaultTemperature } = getLLMConfig();
  const {
    temperature = defaultTemperature,
    maxTokens = defaultMaxTokens,
    model = process.env.AI_MODEL || process.env.AI_MODEL_FALLBACKS || 'gpt-4o-mini',
  } = options;

  // Format messages - handle both user strings and full message objects
  const formattedMessages: ChatMessage[] = messages.map((msg) => {
    if (typeof msg === 'string') {
      return { role: 'user', content: msg };
    }
    if ('role' in msg && 'content' in msg) {
      return msg as ChatMessage;
    }
    // Assume it's a message with just content
    return { role: 'user', content: (msg as any).content || String(msg) };
  });

  // Build full message array with system prompt first
  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...formattedMessages,
  ];

  // Call OpenAI API
  const response = await getOpenAI().chat.completions.create({
    model,
    messages: fullMessages,
    temperature,
    max_tokens: maxTokens,
  });

  // Extract response
  const choice = response.choices[0];
  if (!choice || !choice.message) {
    throw new Error('No response from OpenAI');
  }

  // Return structured response
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

  // format messages
  const formattedMessages: ChatMessage[] = messages.map((msg) => {
    if (typeof msg === 'string') {
      return { role: 'user', content: msg };
    }

    if ('role' in msg && 'content' in msg) {
      return msg as ChatMessage;
    }

    return { role: 'user', content: (msg as any).content || String(msg) };
  });

  // NOTE: Claude doesn't support 'system' role in messages!
  // filter to remove system messages (defensively)
  const claudeMessages = formattedMessages
    .filter(msg => msg.role !== 'system')
    .map(msg => ({
      role: msg.role as 'user' | 'assistant', // Claude only accepts these two options
      content: msg.content,
    }));

  // call Anthropic API 
  const response = await getAnthropic().messages.create({
    model,
    system: systemPrompt,
    messages: claudeMessages,
    temperature,
    max_tokens: maxTokens,
  });

  // extract response (anthropic returns content as an array)
  const textContent = response.content.find(block => block.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude!');
  }

  // normalize to my standard ChatResponse format
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
  // Use lower temperature for Gemini Pro to reduce hallucinations
  const { maxTokens: defaultMaxTokens, temperature: defaultTemperature } = getLLMConfig();
  const { temperature = defaultTemperature, maxTokens = defaultMaxTokens, model = 'gemini-2.5-pro' } = options;

  // format messages
  const formattedMessages: ChatMessage[] = messages.map((msg) => {
    if (typeof msg === 'string') {
      return { role: 'user', content: msg };
    }

    if ('role' in msg && 'content' in msg) {
      return msg as ChatMessage;
    }

    return { role: 'user', content: (msg as any).content || String(msg) };
  });

  // Build conversation history for context awareness
  // Include system prompt at the start for better grounding
  let fullPrompt = `${systemPrompt}\n\n---\n\nConversation History:\n`;
  
  // Add conversation history (exclude the last message which is the current query)
  for (let i = 0; i < formattedMessages.length - 1; i++) {
    const msg = formattedMessages[i];
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    fullPrompt += `${role}: ${msg.content}\n\n`;
  }
  
  // Add current user message
  fullPrompt += `User: ${formattedMessages[formattedMessages.length - 1]?.content || ''}`;

  // Call the @google/genai API
  const response = await getGoogle().models.generateContent({
    model: model,
    contents: fullPrompt,
    config: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  });

  // Extract response - @google/genai returns text directly
  const content = response.text;
  if (!content) {
    console.log('Response structure:', JSON.stringify(response, null, 2));
    throw new Error('No text content in response from Google');
  }

  // @google/genai might not have usage stats in the same structure
  // Default to 0 if not available
  const usage = (response as any).usage || {};
  
  // normalize to standard ChatResponse format
  return {
    content,
    usage: {
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      totalTokens: usage.totalTokens || (usage.promptTokens || 0) + (usage.completionTokens || 0),
    },
    model: model,
    finishReason: (response as any).finishReason || null,
  };
};

// Build fallback chain from environment variables
function buildFallbackChain(primaryModel: string): Array<{ provider: Provider; model: string; reason: string }> {
  const fallbackChain: Array<{ provider: Provider; model: string; reason: string }> = [];
  
  // Add primary model first
  const primaryProvider = detectProvider(primaryModel);
  fallbackChain.push({
    provider: primaryProvider,
    model: primaryModel,
    reason: 'Primary model'
  });
  
  // Comma-separated list or JSON array in AI_MODEL_FALLBACKS
  try {
    const fallbackRaw = process.env.AI_MODEL_FALLBACKS?.trim();
    if (fallbackRaw) {
      let fallbackModels: string[] = [];
      if (fallbackRaw.startsWith("[")) {
        const parsed = JSON.parse(fallbackRaw);
        if (Array.isArray(parsed)) {
          fallbackModels = parsed.filter((m): m is string => typeof m === "string");
        }
      } else {
        fallbackModels = fallbackRaw.split(",").map((m) => m.trim()).filter(Boolean);
      }

      fallbackModels.forEach((model, index) => {
        const provider = detectProvider(model);
        fallbackChain.push({
          provider,
          model,
          reason: `Fallback ${index + 1}`,
        });
      });

      if (fallbackModels.length > 0) {
        console.log(`Loaded ${fallbackModels.length} fallback models from AI_MODEL_FALLBACKS`);
      }
    }
  } catch (error) {
    console.log("Failed to parse AI_MODEL_FALLBACKS:", error);
  }
  
  // If no fallbacks are configured, add default fallbacks
  if (fallbackChain.length === 1) {
    console.log('No fallback models configured in AI_MODEL_FALLBACKS. Using default fallbacks.');
    fallbackChain.push(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', reason: 'Default fallback 1' },
      { provider: 'openai', model: 'gpt-4o', reason: 'Default fallback 2' }
    );
  }
  
  return fallbackChain;
}

// Intelligent fallback system with configurable environment variables
export async function chat(
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const primaryModel = options.model || process.env.AI_MODEL || 'gemini-2.5-flash';
  
  // Build fallback chain from environment variables
  const fallbackChain = buildFallbackChain(primaryModel);
  
  console.log(`Fallback chain: ${fallbackChain.map(f => `${f.model} (${f.provider})`).join(' → ')}`);

  let lastError: any = null;

  for (let i = 0; i < fallbackChain.length; i++) {
    const { provider, model, reason } = fallbackChain[i];
    let startTime = Date.now(); // Declare outside try block so it's available in catch
    
    try {
      console.log(`Attempting ${provider} (${model}) - ${reason}`);
      
      // Call provider
      const response = await callProvider(provider, messages, systemPrompt, { ...options, model });
      
      // Trace the successful call (fire and forget — LangSmith + LangFuse)
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
      
      // Log usage for monitoring
      logUsage(provider, model, response.usage.totalTokens);
      
      if (i > 0) {
        console.log(`Fallback successful: ${provider} (${model})`);
      }
      
      return response;
      
    } catch (error: any) {
      lastError = error;
      console.log(`${provider} failed:`, error.message);
      
      // Trace the failure (fire and forget)
      traceLLMCall(provider, model, messages as ChatMessage[], systemPrompt, {
        content: `Error: ${error.message}`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      } as ChatResponse, startTime, options)
        .catch(err => console.error('Tracing error (LangSmith):', err));
      traceLLMCallLangFuse(provider, model, messages as ChatMessage[], systemPrompt, {
        content: `Error: ${error.message}`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      } as ChatResponse, startTime, options)
        .catch(err => console.error('Tracing error (Langfuse):', err));
      
      // Check if this is a retryable error
      if (isRetryableError(error)) {
        console.log(`Retrying with next provider...`);
        continue;
      } else {
        // Non-retryable error (e.g., invalid API key), don't try other providers
        throw error;
      }
    }
  }

  // If we get here, all providers failed
  console.error('🚨 All providers failed');
  throw new Error(`All LLM providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

// Helper function to call the appropriate provider
async function callProvider(
  provider: Provider,
  messages: Omit<ChatMessage, 'role'>[] | ChatMessage[],
  systemPrompt: string,
  options: ChatOptions
): Promise<ChatResponse> {
  switch (provider) {
    case 'openai':
      return await callOpenAI(messages, systemPrompt, options);
    case 'anthropic':
      return await callAnthropic(messages, systemPrompt, options);
    case 'google':
      return await callGoogle(messages, systemPrompt, options);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// Check if an error is retryable (rate limits, temporary failures)
function isRetryableError(error: any): boolean {
  // Rate limit errors
  if (error.status === 429) {
    return true;
  }
  
  // Quota exceeded
  if (error.message?.includes('quota') || error.message?.includes('Quota')) {
    return true;
  }
  
  // Rate limit exceeded
  if (error.message?.includes('rate limit') || error.message?.includes('Rate limit')) {
    return true;
  }
  
  // Temporary server errors
  if (error.status === 500 || error.status === 503 || error.status === 502) {
    return true;
  }
  
  // Google-specific errors
  if (error.message?.includes('MAX_TOKENS') || error.message?.includes('RESOURCE_EXHAUSTED')) {
    return true;
  }
  
  // Network errors (might be temporary)
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return true;
  }
  
  // Non-retryable errors
  if (error.status === 401) {
    return false; // Invalid API key
  }
  
  if (error.status === 400) {
    return false; // Bad request (malformed input)
  }
  
  if (error.status === 403) {
    return false; // Forbidden (API key issues)
  }
  
  // Default to retryable for unknown errors
  return true;
}

// Cost tracking and usage monitoring
export interface UsageStats {
  provider: string;
  model: string;
  tokens: number;
  cost: number;
  timestamp: Date;
}

// Simple cost tracking (approximate costs per 1K tokens)
const COST_PER_1K_TOKENS = {
  'gemini-2.5-flash': 0.0, // Free tier
  'gemini-2.5-pro': 0.0, // Free tier (100 requests/day)
  'claude-haiku-4-5-20251001': 0.00025, // $0.25 per 1M tokens
  'gpt-4o': 0.005, // $5 per 1M tokens
  'gpt-4o-mini': 0.00015, // $0.15 per 1M tokens
};

function calculateCost(model: string, tokens: number): number {
  const costPer1K = (COST_PER_1K_TOKENS as Record<string, number>)[model] || 0.001; // Default fallback
  return (tokens / 1000) * costPer1K;
}

// Log usage for monitoring
function logUsage(provider: string, model: string, tokens: number): void {
  const cost = calculateCost(model, tokens);
  console.log(`💰 Usage: ${provider} (${model}) - ${tokens} tokens - $${cost.toFixed(4)}`);
}

// Testing function to check the OpenAI connection
export async function testConnection(): Promise<boolean> {
  try {
    await getOpenAI().models.list();
    return true;
  } catch (error) {
    console.error('OpenAI connection test failed:', error);
    return false;
  }
}