/**
 * Eval scoring dimensions, types, judge prompts, and cross-provider judge mapping.
 *
 * Config-only module — consumed by eval-judge.ts, eval-format.ts, eval-extract.ts,
 * and scripts/eval-cv.ts. Defines the 4 eval dimensions used to select TAILOR_MODEL.
 */

import { getEnvString } from "../../../lib/env";

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
}

export interface HallucinationScore {
  score: number;
  flaggedClaims: string[];
}

export interface ExtractionScore {
  score: number;
  reasoning: string;
  gaps: string[];
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
}

export const CANDIDATE_GENERATION_MODELS = [
  "deepseek/deepseek-v4-pro",
  "anthropic/sonnet",
  "openrouter/openai/gpt-5.4-mini",
  "openrouter/google/gemini-2.5-pro",
] as const;

export type CandidateGenerationModel = (typeof CANDIDATE_GENERATION_MODELS)[number];

export const DEFAULT_EVAL_JUDGE_MODEL = "anthropic/sonnet";
export const DEFAULT_EVAL_EXTRACTION_MIN_SCORE = 0.7;
export const DEFAULT_EVAL_EXTRACTION_MODEL = "openrouter/openai/gpt-4o-mini";

/** Canonical comma-separated default for `EVAL_MODELS` (derived from candidate list). */
export const DEFAULT_EVAL_MODELS_CSV = CANDIDATE_GENERATION_MODELS.join(",");

const DEFAULT_JUDGE_MAP: Record<string, string> = {
  "deepseek/deepseek-v4-pro": "anthropic/sonnet",
  "anthropic/sonnet": "deepseek/deepseek-v4-pro",
  "openrouter/openai/gpt-5.4-mini": "anthropic/sonnet",
  "openrouter/google/gemini-2.5-pro": "deepseek/deepseek-v4-pro",
  [DEFAULT_EVAL_EXTRACTION_MODEL]: "anthropic/sonnet",
};

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

/** Cross-provider judge mapping: generator model → judge model (different provider). */
export const JUDGE_MAP: Record<string, string> = buildJudgeMap();

export function warnUnmappedJudgeModels(models: readonly string[]): void {
  for (const model of models) {
    if (!(model in JUDGE_MAP)) {
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
