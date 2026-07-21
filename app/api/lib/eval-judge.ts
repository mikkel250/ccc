/**
 * LLM-as-Judge scorers for smoke (JSON master+curated) and legacy markdown helpers.
 *
 * scoreJsonGrounding / scoreJsonJdFit — smoke path (npm run smoke)
 * scoreExtraction / scoreRelevance / scoreHallucination — legacy offline helpers
 * resolveJudgeModel — maps generator model → judge model via getJudgeMap()
 *
 * Not invoked by POST /api/tailor-cv.
 */
import { chat, type ChatMessage, type ChatResponse } from "./llm";
import { getEvalJudgeModel } from "../../../lib/env";
import {
  EXTRACTION_JUDGE_PROMPT,
  HALLUCINATION_JUDGE_PROMPT,
  getJudgeMap,
  warnUnmappedJudgeModels,
  RELEVANCE_JUDGE_PROMPT,
  JSON_GROUNDING_JUDGE_PROMPT,
  JSON_JD_FIT_JUDGE_PROMPT,
  type ExtractionScore,
  type HallucinationScore,
  type JdExtraction,
  type RelevanceScore,
} from "./eval-schema";
import { extractStructuredJson, parseStringArray } from "./eval-parse";

export { extractStructuredJson } from "./eval-parse";

type ChatFn = (
  messages: ChatMessage[] | Omit<ChatMessage, "role">[],
  systemPrompt: string,
  options?: { model?: string; source?: string }
) => Promise<ChatResponse>;

export interface JudgeScoreOptions {
  chat?: ChatFn;
}

function formatKbContext(kbFiles: Record<string, string>): string {
  return Object.entries(kbFiles)
    .map(([name, content]) => `### ${name}\n${content}`)
    .join("\n\n");
}

function formatRequirements(extraction: JdExtraction): string {
  return extraction.requirements
    .map((r) => `- [${r.weight}] ${r.statement} (keywords: ${r.keywords.join(", ")})`)
    .join("\n");
}

function formatKeywordBank(extraction: JdExtraction): string {
  const bank = extraction.keywordBank;
  const parts: string[] = [];
  if (bank.mustHaves?.length) parts.push(`Must-haves: ${bank.mustHaves.join(", ")}`);
  if (bank.tools?.length) parts.push(`Tools: ${bank.tools.join(", ")}`);
  if (bank.certifications?.length) parts.push(`Certifications: ${bank.certifications.join(", ")}`);
  if (bank.verbs?.length) parts.push(`Verbs: ${bank.verbs.join(", ")}`);
  return parts.join("\n") || "None extracted";
}

function formatExtractionContext(extraction: JdExtraction): string {
  return `## Extracted Requirements\n${formatRequirements(extraction) || "None"}\n\n## Keywords\n${formatKeywordBank(extraction)}\n\n## Hiring Context\n${extraction.hiringContext}`;
}

/** Resolve cross-provider judge model for a generator model. */
export function resolveJudgeModel(generatorModel: string): string {
  const judgeMap = getJudgeMap();
  if (generatorModel in judgeMap) {
    return judgeMap[generatorModel]!;
  }
  warnUnmappedJudgeModels([generatorModel]);
  return getEvalJudgeModel();
}

function parseRelevanceScore(
  value: unknown
): { ok: true; score: number } | { ok: false } {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return { ok: false };
  return { ok: true, score: Math.min(5, Math.max(1, Math.round(num))) };
}

function clampUnitScore(value: unknown, fallback = 0.5): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

function parseUnitScore(
  value: unknown
): { ok: true; score: number } | { ok: false } {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return { ok: false };
  return { ok: true, score: Math.min(1, Math.max(0, num)) };
}

export async function scoreExtraction(
  extraction: JdExtraction,
  _rawJd: string,
  judgeModel: string,
  options: JudgeScoreOptions = {}
): Promise<ExtractionScore> {
  const chatFn = options.chat ?? chat;

  const userContent = `## Structured Extraction\n${JSON.stringify(extraction, null, 2)}`;

  try {
    const response = await chatFn(
      [{ role: "user", content: userContent }],
      EXTRACTION_JUDGE_PROMPT,
      { model: judgeModel, source: "eval-extraction" }
    );

    const parsed = extractStructuredJson(response.content) as {
      score?: unknown;
      reasoning?: unknown;
      gaps?: unknown;
    };

    return {
      score: clampUnitScore(parsed.score, 0.5),
      reasoning:
        typeof parsed.reasoning === "string"
          ? parsed.reasoning
          : "No reasoning provided",
      gaps: parseStringArray(parsed.gaps),
      parseFailed: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("scoreExtraction parse failure:", message);
    return {
      score: 0.5,
      reasoning: `Parse failure: ${message}`,
      gaps: [],
      parseFailed: true,
    };
  }
}

export async function scoreRelevance(
  cv: string,
  extraction: JdExtraction,
  kbFiles: Record<string, string>,
  judgeModel: string,
  options: JudgeScoreOptions = {}
): Promise<RelevanceScore> {
  const chatFn = options.chat ?? chat;
  const kbContext = formatKbContext(kbFiles);
  const extractionContext = formatExtractionContext(extraction);

  const userContent = `${extractionContext}\n\n## Knowledge Base\n${kbContext}\n\n## CV\n${cv}`;

  try {
    const response = await chatFn(
      [{ role: "user", content: userContent }],
      RELEVANCE_JUDGE_PROMPT,
      { model: judgeModel, source: "eval-relevance" }
    );

    const parsed = extractStructuredJson(response.content) as {
      score?: unknown;
      reasoning?: unknown;
    };

    const score = parseRelevanceScore(parsed.score);
    if (!score.ok) {
      return {
        score: 1,
        reasoning:
          typeof parsed.reasoning === "string"
            ? parsed.reasoning
            : "Missing or invalid relevance score",
        parseFailed: true,
      };
    }

    return {
      score: score.score,
      reasoning:
        typeof parsed.reasoning === "string"
          ? parsed.reasoning
          : "No reasoning provided",
      parseFailed: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("scoreRelevance parse failure:", message);
    return {
      score: 1,
      reasoning: `Parse failure: ${message}`,
      parseFailed: true,
    };
  }
}

export async function scoreHallucination(
  cv: string,
  extraction: JdExtraction,
  kbFiles: Record<string, string>,
  judgeModel: string,
  options: JudgeScoreOptions = {}
): Promise<HallucinationScore> {
  const chatFn = options.chat ?? chat;
  const kbContext = formatKbContext(kbFiles);
  const extractionContext = formatExtractionContext(extraction);

  const userContent = `${extractionContext}\n\n## Knowledge Base (ground truth)\n${kbContext}\n\n## CV\n${cv}`;

  try {
    const response = await chatFn(
      [{ role: "user", content: userContent }],
      HALLUCINATION_JUDGE_PROMPT,
      { model: judgeModel, source: "eval-hallucination" }
    );

    const parsed = extractStructuredJson(response.content) as {
      score?: unknown;
      flaggedClaims?: unknown;
    };

    const flaggedClaims = parseStringArray(parsed.flaggedClaims);

    return {
      score: clampUnitScore(parsed.score, 0.5),
      flaggedClaims,
      parseFailed: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("scoreHallucination parse failure:", message);
    return {
      score: 0.5,
      flaggedClaims: [],
      parseFailed: true,
    };
  }
}

export type JsonGroundingScore = {
  score: number;
  flaggedClaims: string[];
  parseFailed: boolean;
};

export type JsonJdFitScore = {
  score: number;
  reasoning: string;
  parseFailed: boolean;
};

/** Grounding judge for smoke: master + curated JSON (+ JD context). Higher score = better. */
export async function scoreJsonGrounding(
  masterCv: unknown,
  curatedCv: unknown,
  jobDescription: string,
  judgeModel: string,
  options: JudgeScoreOptions = {}
): Promise<JsonGroundingScore> {
  const chatFn = options.chat ?? chat;
  const userContent = [
    "## Job description (untrusted context only)",
    jobDescription,
    "",
    "## Master CV JSON (ground truth)",
    JSON.stringify(masterCv),
    "",
    "## Curated CV JSON",
    JSON.stringify(curatedCv),
  ].join("\n");

  try {
    const response = await chatFn(
      [{ role: "user", content: userContent }],
      JSON_GROUNDING_JUDGE_PROMPT,
      { model: judgeModel, source: "smoke-grounding" }
    );
    const parsed = extractStructuredJson(response.content) as {
      score?: unknown;
      flaggedClaims?: unknown;
    };
    const score = parseUnitScore(parsed.score);
    if (!score.ok) {
      return { score: 0, flaggedClaims: [], parseFailed: true };
    }
    return {
      score: score.score,
      flaggedClaims: parseStringArray(parsed.flaggedClaims),
      parseFailed: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("scoreJsonGrounding parse failure:", message);
    return { score: 0, flaggedClaims: [], parseFailed: true };
  }
}

/** JD-fit judge for smoke: curated JSON vs JD (master for availability context). */
export async function scoreJsonJdFit(
  masterCv: unknown,
  curatedCv: unknown,
  jobDescription: string,
  judgeModel: string,
  options: JudgeScoreOptions = {}
): Promise<JsonJdFitScore> {
  const chatFn = options.chat ?? chat;
  const userContent = [
    "## Job description",
    jobDescription,
    "",
    "## Master CV JSON (available content)",
    JSON.stringify(masterCv),
    "",
    "## Curated CV JSON",
    JSON.stringify(curatedCv),
  ].join("\n");

  try {
    const response = await chatFn(
      [{ role: "user", content: userContent }],
      JSON_JD_FIT_JUDGE_PROMPT,
      { model: judgeModel, source: "smoke-jd-fit" }
    );
    const parsed = extractStructuredJson(response.content) as {
      score?: unknown;
      reasoning?: unknown;
    };
    const score = parseRelevanceScore(parsed.score);
    if (!score.ok) {
      return {
        score: 1,
        reasoning:
          typeof parsed.reasoning === "string"
            ? parsed.reasoning
            : "Missing or invalid jd-fit score",
        parseFailed: true,
      };
    }
    return {
      score: score.score,
      reasoning:
        typeof parsed.reasoning === "string"
          ? parsed.reasoning
          : "No reasoning provided",
      parseFailed: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("scoreJsonJdFit parse failure:", message);
    return { score: 1, reasoning: `Parse failure: ${message}`, parseFailed: true };
  }
}
