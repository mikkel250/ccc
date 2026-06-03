export function getEnvNumber(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function getEnvString(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

export function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const lowered = raw.toLowerCase();
  if (['true', '1', 'yes'].includes(lowered)) return true;
  if (['false', '0', 'no'].includes(lowered)) return false;
  return defaultValue;
}

const DEFAULT_LLM_MAX_TOKENS = 8192;
const DEFAULT_LLM_TEMPERATURE = 0.3;
const DEFAULT_LLM_MODEL = 'openrouter/openai/gpt-5.4-mini';
const DEFAULT_TAILOR_MODEL = 'openrouter/google/gemini-2.5-pro';
const MIN_MAX_TOKENS = 1;

function parseMaxTokens(raw: string | undefined, limit: number): number {
  const fallback = Math.min(Math.floor(DEFAULT_LLM_MAX_TOKENS), limit);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_MAX_TOKENS) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), limit);
}

function parseTemperature(raw: string | undefined): number {
  if (!raw) return DEFAULT_LLM_TEMPERATURE;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LLM_TEMPERATURE;
  return Math.min(1, Math.max(0, parsed));
}

export function getLLMConfig() {
  const maxTokensLimit = getEnvNumber('AI_MAX_TOKENS_LIMIT', 128_000);
  const maxTokens = parseMaxTokens(process.env.AI_MAX_TOKENS, maxTokensLimit);
  const temperature = parseTemperature(process.env.AI_TEMPERATURE);
  const openRouterFlex = getEnvBoolean('OPENROUTER_FLEX_ENABLED', true);
  const defaultModel = process.env.AI_MODEL || DEFAULT_LLM_MODEL;
  return { maxTokens, temperature, openRouterFlex, defaultModel };
}

export function getDefaultLlmModel(): string {
  return getLLMConfig().defaultModel;
}

export function getTailorModel(): string {
  return process.env.TAILOR_MODEL || process.env.AI_MODEL || DEFAULT_TAILOR_MODEL;
}
