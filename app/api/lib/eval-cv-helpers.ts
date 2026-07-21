/**
 * Shared helpers formerly in scripts/eval-cv.ts (markdown gen path retired).
 * Kept for eval-results artifact checks and seed script.
 */
import path from "node:path";
import { validateGenerationModels } from "./eval-model-validation";
import {
  CANDIDATE_GENERATION_MODELS,
  warnUnmappedJudgeModels,
  type ExtractionScore,
  type FormatScore,
  type HallucinationScore,
  type RelevanceScore,
} from "./eval-schema";
import { getEvalModels } from "../../../lib/env";

export const DEFAULT_EVAL_MODELS = CANDIDATE_GENERATION_MODELS;

export interface EvalScoresPayload {
  format: FormatScore;
  relevance: RelevanceScore;
  hallucination: HallucinationScore;
  extraction: ExtractionScore;
  metadata: {
    jdSlug: string;
    model: string;
    judgeModel: string;
    extractionJudgeModel: string;
  };
}

export interface EvalUsagePayload {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  model: string;
}

export function parseEvalModels(): string[] {
  const raw = getEvalModels();
  const models = !raw?.trim()
    ? [...DEFAULT_EVAL_MODELS]
    : raw
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
  validateGenerationModels(models);
  warnUnmappedJudgeModels(models);
  return models;
}

export function buildEvalArtifactDir(jdSlug: string, model: string): string {
  const modelSegments = model.split("/");
  return path.join("eval-results", jdSlug, ...modelSegments);
}

export function buildScoresPayload(input: {
  format: FormatScore;
  relevance: RelevanceScore;
  hallucination: HallucinationScore;
  extraction: ExtractionScore;
  metadata: EvalScoresPayload["metadata"];
}): EvalScoresPayload {
  return {
    format: input.format,
    relevance: input.relevance,
    hallucination: input.hallucination,
    extraction: input.extraction,
    metadata: input.metadata,
  };
}

export function buildUsagePayload(input: EvalUsagePayload): EvalUsagePayload {
  return { ...input };
}
