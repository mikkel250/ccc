/**
 * Historical eval scoring dimensions and types.
 *
 * Config-only module — consumed by eval-format.ts, eval-extract.ts, and
 * scripts/seed-eval-results.ts. Defines the 4 historical eval dimensions used
 * to select TAILOR_MODEL. JSON smoke judges and JUDGE_MAP are retired.
 */

export {
  DEFAULT_EVAL_EXTRACTION_MIN_SCORE,
  DEFAULT_EVAL_EXTRACTION_MODEL,
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
