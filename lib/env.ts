/**
 * Centralized environment variable parsing and model defaults.
 *
 * Every tunable (models, tokens, temperature, eval config) flows through here.
 * Production CV generation uses `getTailorModel()` (TAILOR_MODEL); generic chat
 * defaults use `getDefaultLlmModel()` (AI_MODEL). See .env.example for the catalog.
 */
export function getEnvNumber(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function getEnvString(key: string, defaultValue?: string): string | undefined {
  const value = process.env[key];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  return value;
}

import {
  DEFAULT_EVAL_EXTRACTION_MIN_SCORE,
  DEFAULT_EVAL_EXTRACTION_MODEL,
  DEFAULT_EVAL_JUDGE_MODEL,
  DEFAULT_EVAL_MODELS_CSV,
} from '../app/api/lib/eval-defaults';
import { KNOWN_PROVIDERS, type Provider } from './providers';

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
const DEFAULT_TAILOR_MODEL = 'anthropic/sonnet';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const MIN_MAX_TOKENS = 1;

function validateDefaultModel(model: string): string {
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(`Invalid AI_MODEL "${model}": must be namespaced as provider/model`);
  }
  const provider = model.slice(0, slash);
  if (!KNOWN_PROVIDERS.has(provider as Provider)) {
    throw new Error(`Unknown provider "${provider}" in AI_MODEL "${model}"`);
  }
  return model;
}

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
  const defaultModel = validateDefaultModel(process.env.AI_MODEL || DEFAULT_LLM_MODEL);
  return { maxTokens, temperature, openRouterFlex, defaultModel };
}

export function getDeepSeekBaseUrl(): string {
  return getEnvString('DEEPSEEK_BASE_URL', DEFAULT_DEEPSEEK_BASE_URL)!;
}

export function getDefaultLlmModel(): string {
  return getLLMConfig().defaultModel;
}

export function getTailorModel(): string {
  return validateDefaultModel(process.env.TAILOR_MODEL || DEFAULT_TAILOR_MODEL);
}

export function getEvalJudgeModel(): string {
  return validateDefaultModel(
    getEnvString('EVAL_JUDGE_MODEL', DEFAULT_EVAL_JUDGE_MODEL)!
  );
}

export function getEvalModels(): string {
  return getEnvString('EVAL_MODELS', DEFAULT_EVAL_MODELS_CSV)!;
}

export function getEvalExtractionModel(): string {
  return validateDefaultModel(
    getEnvString('EVAL_EXTRACTION_MODEL', DEFAULT_EVAL_EXTRACTION_MODEL)!
  );
}

export function getEvalExtractionMinScore(): number {
  const raw = process.env.EVAL_EXTRACTION_MIN_SCORE;
  if (!raw) return DEFAULT_EVAL_EXTRACTION_MIN_SCORE;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_EVAL_EXTRACTION_MIN_SCORE;
}
