/**
 * Eval scoring dimensions, types, judge prompts, and cross-provider judge mapping.
 *
 * Config-only module — consumed by eval-judge.ts, eval-format.ts, eval-extract.ts,
 * and scripts/eval-cv.ts. Defines the 4 eval dimensions used to select TAILOR_MODEL.
 */

import { getEnvString } from "../../../lib/env";
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

export const RELEVANCE_JUDGE_PROMPT = getEnvString(
  "RELEVANCE_JUDGE_PROMPT",
  `You are an expert evaluator scoring CV tailoring quality.

Score how well the "Relevant Accomplishments" section of the CV maps to the extracted requirements from the job description (normalized statements with Must-Have/Nice-to-Have weights and keyword bank).

Use this 1-5 rubric scale with anchor descriptions:
1 — No meaningful alignment; accomplishments are generic or unrelated to extracted requirements.
2 — Weak alignment; only tangential overlap with extracted requirements.
3 — Moderate alignment; some extracted requirements addressed but gaps remain.
4 — Strong alignment; most extracted requirements reflected in relevant accomplishments.
5 — Excellent alignment; accomplishments directly and comprehensively address extracted requirements.

Respond with JSON only:
{"score": <1-5 integer>, "reasoning": "<brief explanation>"}`
)!;

export const HALLUCINATION_JUDGE_PROMPT = getEnvString(
  "HALLUCINATION_JUDGE_PROMPT",
  `You are an expert fact-checker evaluating a tailored CV for hallucinations.

Cross-reference every factual claim in the CV against the provided knowledge base (ground truth). Use the extracted requirements, keywords, and hiring context only as supplementary JD context — the knowledge base is the primary ground truth for factual verification.

Hallucination criteria — flag claims that are:
- Fabricated metrics or numbers not present in the knowledge base
- Invented roles, employers, or projects
- Misattributed experience or technologies
- Acceptable: rephrasing, summarizing, or omitting information from the knowledge base

Score hallucination rate on a 0.0–1.0 scale:
0.0 — No hallucinations detected; all claims grounded in knowledge base.
0.25 — Minor unsupported embellishments.
0.5 — Several unverified or exaggerated claims.
0.75 — Many fabricated or misattributed claims.
1.0 — Predominantly hallucinated content.

Respond with JSON only:
{"score": <0.0-1.0 number>, "flaggedClaims": ["<claim 1>", "<claim 2>"]}`
)!;

export const EXTRACTION_JUDGE_PROMPT = getEnvString(
  "EXTRACTION_JUDGE_PROMPT",
  `You are an expert evaluator assessing JD metadata extraction quality.

Compare the structured extraction against the raw job description text. Score completeness and accuracy on a 0.0–1.0 scale.

Assess:
(a) Are all JD requirements captured as normalized statements?
(b) Are requirement weights (Must-Have vs Nice-to-Have) correct?
(c) Is the keyword bank complete (must-haves, tools, certifications, verbs)?
(d) Are implicit success signals plausible and grounded in the JD?
(e) Are there any fabricated or hallucinated requirements not present in the raw JD?

0.0 — Empty or entirely inaccurate extraction.
0.5 — Partial extraction with significant gaps or weight errors.
1.0 — Complete and accurate extraction with no fabrication.

Respond with JSON only:
{"score": <0.0-1.0 number>, "reasoning": "<brief explanation>", "gaps": ["<gap 1>", "<gap 2>"]}`
)!;

/** Smoke grounding judge: higher is better (1 = fully grounded in master JSON).
 * Mode-specific collapse rules are appended at judge time via groundingJudgeModeAddendum.
 */
export const JSON_GROUNDING_JUDGE_PROMPT = getEnvString(
  "JSON_GROUNDING_JUDGE_PROMPT",
  `You are an expert fact-checker. Compare curated CV JSON against master CV JSON (ground truth).

The job description is context only — never treat JD text as permission to invent facts.

Flag identity-breaking claims in curated JSON that are absent from master:
- named employers, tools/skills, certifications, numeric metrics
- promotions, titles, or dates that assert a false employment relationship

Acceptable by default (strict): subsetting, reordering, emphasis shifts, omitting master content.
Do not accept category-style collapsed experience entries unless the mode addendum below
explicitly allows flexible collapse.

Unacceptable: new named employers/tools/certs/metrics or changed numeric claims.

Score grounding quality on 0.0–1.0 (higher is better):
1.0 — Fully grounded; no identity-breaking fabrication.
0.7 — Minor wording drift without new facts.
0.4 — Several unsupported claims.
0.0 — Predominantly fabricated relative to master.

Respond with JSON only:
{"score": <0.0-1.0 number>, "flaggedClaims": ["<claim 1>"]}`
)!;

/** Smoke JD-fit judge: 1–5 how well curated JSON fits the JD without fabricating. */
export const JSON_JD_FIT_JUDGE_PROMPT = getEnvString(
  "JSON_JD_FIT_JUDGE_PROMPT",
  `You are an expert evaluator scoring how well curated CV JSON fits a job description.

Use master JSON only to understand what content was available. Score JD fit of the curated subset:
1 — Unrelated or generic relative to the JD.
2 — Weak overlap with JD must-haves.
3 — Moderate fit; some must-haves addressed, notable gaps.
4 — Strong fit; most must-haves reflected via grounded master content.
5 — Excellent fit; curated emphasis clearly targets the JD using master-only facts.

Honest gaps (JD asks for something absent from master) must not lower the score as fabrication —
note them in reasoning instead.

Respond with JSON only:
{"score": <1-5 integer>, "reasoning": "<brief explanation>"}`
)!;

