/**
 * Eval scoring dimensions, types, and cross-provider judge mapping.
 *
 * Config-only module — consumed by eval-format.ts, eval-extract.ts, and
 * scripts/seed-eval-results.ts. Defines the 4 historical eval dimensions used
 * to select TAILOR_MODEL. JSON smoke judges are retired; prompt env overrides
 * were removed with the scorers (no remaining production caller).
 */

import {
  DEFAULT_EVAL_EXTRACTION_MODEL,
  DEFAULT_EVAL_JUDGE_MODEL,
  DEFAULT_EVAL_MODELS_CSV,
} from "./eval-defaults";

export {
  DEFAULT_EVAL_EXTRACTION_MIN_SCORE,
  DEFAULT_EVAL_EXTRACTION_MODEL,
  DEFAULT_EVAL_JUDGE_MODEL,
  DEFAULT_EVAL_MODELS_CSV,
} from "./eval-defaults";

export enum EvalDimension {
  FORMAT = "format",
  RELEVANCE = "relevance",
  HALLUCINATION = "hallucination",
  EXTRACTION = "extraction",
}

export enum FormatSection {
  CONTACT_INFORMATION = "Contact Information",
  OBJECTIVE_VALUE_STATEMENT = "Objective Value Statement",
  RELEVANT_ACCOMPLISHMENTS = "Relevant Accomplishments",
  TECHNICAL_SKILLS = "Technical Skills",
  STANDARD_JOB_INFORMATION = "Standard Job Information",
  COMPANY_SUMMARIES = "Company Summaries",
  MEASURABLE_ACCOMPLISHMENTS = "Measurable Accomplishments",
  EDUCATION = "Education",
}

export interface FormatScore {
  score: number;
  breakdown: Record<string, boolean>;
  details: string[];
}

export interface RelevanceScore {
  score: number;
  reasoning: string;
  parseFailed: boolean;
}

export interface HallucinationScore {
  score: number;
  flaggedClaims: string[];
  parseFailed: boolean;
}

export interface ExtractionScore {
  score: number;
  reasoning: string;
  gaps: string[];
  parseFailed: boolean;
}

export type JdRequirementWeight = "Must-Have" | "Nice-to-Have";

export interface JdRequirement {
  statement: string;
  weight: JdRequirementWeight;
  keywords: string[];
}

export interface JdKeywordBank {
  mustHaves?: string[];
  tools?: string[];
  certifications?: string[];
  verbs?: string[];
}

export interface JdExtraction {
  requirements: JdRequirement[];
  hiringContext: string;
  roleType: string;
  topTechnologies: string[];
  primaryResponsibilities: string[];
  title: string;
  seniority: string;
  domainKnowledge: string[];
  keyVerbs: string[];
  implicitSuccessSignals: string[];
  keywordBank: JdKeywordBank;
  rawJd: string;
  parseFailed: boolean;
}

export const CANDIDATE_GENERATION_MODELS = [
  "deepseek/deepseek-v4-pro",
  "openrouter/qwen/qwen3.7-max",
  "openrouter/xiaomi/mimo-v2.5-pro",
  "openrouter/minimax/minimax-m3",
  "openrouter/google/gemini-3.1-pro-preview",
  "openrouter/openai/gpt-5.4",
  "openrouter/openai/gpt-5.5",
  "anthropic/sonnet",
  "anthropic/opus",
] as const;

export type CandidateGenerationModel = (typeof CANDIDATE_GENERATION_MODELS)[number];

const DEFAULT_JUDGE_MAP: Record<string, string> = {
  "deepseek/deepseek-v4-pro": "openrouter/google/gemini-3.1-pro-preview",
  "openrouter/qwen/qwen3.7-max": "openrouter/google/gemini-3.1-pro-preview",
  "openrouter/xiaomi/mimo-v2.5-pro": "openrouter/google/gemini-3.1-pro-preview",
  "openrouter/minimax/minimax-m3": "openrouter/google/gemini-3.1-pro-preview",
  "anthropic/sonnet": "openrouter/openai/gpt-5.4",
  "anthropic/opus": "openrouter/openai/gpt-5.4",
  "openrouter/google/gemini-3.1-pro-preview": "openrouter/openai/gpt-5.4",
  "openrouter/openai/gpt-5.4": "openrouter/google/gemini-3.1-pro-preview",
  "openrouter/openai/gpt-5.5": "openrouter/google/gemini-3.1-pro-preview",
  [DEFAULT_EVAL_EXTRACTION_MODEL]: "openrouter/google/gemini-3.1-pro-preview",
};

export function providerOf(model: string): string {
  const firstSlash = model.indexOf("/");
  const gateway = model.slice(0, firstSlash);
  // For OpenRouter-prefixed models, resolve the underlying vendor
  // (e.g. openrouter/openai/gpt-5.4 → openai, openrouter/qwen/qwen3.7-max → qwen)
  if (gateway === "openrouter") {
    const rest = model.slice(firstSlash + 1);
    const secondSlash = rest.indexOf("/");
    return secondSlash > 0 ? rest.slice(0, secondSlash) : rest;
  }
  return gateway;
}

function isNamespacedModelString(value: unknown): value is string {
  return typeof value === "string" && /^[^/\s]+\/.+/.test(value);
}

function buildJudgeMap(): Record<string, string> {
  const raw = process.env.EVAL_JUDGE_MAP_JSON?.trim();
  if (!raw) {
    return { ...DEFAULT_JUDGE_MAP };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[eval] Invalid EVAL_JUDGE_MAP_JSON — using default JUDGE_MAP"
    );
    return { ...DEFAULT_JUDGE_MAP };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(
      "[eval] EVAL_JUDGE_MAP_JSON must be a JSON object — using default JUDGE_MAP"
    );
    return { ...DEFAULT_JUDGE_MAP };
  }

  const map: Record<string, string> = { ...DEFAULT_JUDGE_MAP };
  for (const [generator, judge] of Object.entries(parsed)) {
    if (!isNamespacedModelString(generator) || !isNamespacedModelString(judge)) {
      continue;
    }
    if (providerOf(generator) === providerOf(judge)) {
      console.warn(
        `[eval] Rejected same-provider override: ${generator} → ${judge}`
      );
      continue;
    }
    map[generator] = judge;
  }

  if (!(DEFAULT_EVAL_EXTRACTION_MODEL in map)) {
    map[DEFAULT_EVAL_EXTRACTION_MODEL] =
      DEFAULT_JUDGE_MAP[DEFAULT_EVAL_EXTRACTION_MODEL] ?? DEFAULT_EVAL_JUDGE_MODEL;
  }

  for (const model of CANDIDATE_GENERATION_MODELS) {
    if (!(model in map)) {
      map[model] = DEFAULT_EVAL_JUDGE_MODEL;
    }
  }

  return map;
}

let _judgeMap: Record<string, string> | null = null;

export function getJudgeMap(): Record<string, string> {
  if (!_judgeMap) {
    _judgeMap = buildJudgeMap();
  }
  return _judgeMap;
}

export function resetJudgeMapCache(): void {
  _judgeMap = null;
}

/** @deprecated Use getJudgeMap() for lazy initialization and testable env overrides. */
export const JUDGE_MAP: Record<string, string> = buildJudgeMap();

export function warnUnmappedJudgeModels(models: readonly string[]): void {
  const judgeMap = getJudgeMap();
  for (const model of models) {
    if (!(model in judgeMap)) {
      // [SIDE-EFFECT] stderr warning when eval model lacks cross-provider judge mapping
      console.warn(
        `[eval] No JUDGE_MAP entry for "${model}" — judge will fall back to EVAL_JUDGE_MODEL (${DEFAULT_EVAL_JUDGE_MODEL}); cross-provider constraint may be violated`
      );
    }
  }
}

