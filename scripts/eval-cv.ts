#!/usr/bin/env npx tsx
/**
 * LLM-as-Judge evaluation pipeline — generates CVs per JD×model, scores, and writes artifacts.
 */

import fs from "node:fs";
import path from "node:path";
import { getCvPromptFallbackText, compileCvPrompt } from "../app/api/lib/cv-prompt";
import { getAllContext as getAllContextDefault } from "../app/api/lib/knowledge-base";
import { chat, type ChatMessage, type ChatResponse } from "../app/api/lib/llm";
import { initLangFuse } from "../app/api/lib/langfuse";
import type { Evaluation } from "@langfuse/client";
import { flushLangfuseTraces } from "../app/api/lib/langfuse-otel";
import { validateGenerationModels } from "../app/api/lib/eval-model-validation";
import {
  CANDIDATE_GENERATION_MODELS,
  EvalDimension,
  warnUnmappedJudgeModels,
  type ExtractionScore,
  type FormatScore,
  type HallucinationScore,
  type JdExtraction,
  type RelevanceScore,
} from "../app/api/lib/eval-schema";
import { extractJdMetadata as extractJdMetadataDefault } from "../app/api/lib/eval-extract";
import { scoreFormatCompliance } from "../app/api/lib/eval-format";
import {
  resolveJudgeModel,
  scoreExtraction as scoreExtractionDefault,
  scoreHallucination,
  scoreRelevance,
} from "../app/api/lib/eval-judge";
import { getEvalExtractionMinScore, getEvalExtractionModel, getEvalModels } from "../lib/env";

export const DEFAULT_EVAL_MODELS = CANDIDATE_GENERATION_MODELS;

export interface JdFile {
  slug: string;
  content: string;
}

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

export interface RunEvalCvSummary {
  completedPairs: number;
  failedPairs: number;
  warnings: string[];
}

type ChatFn = (
  messages: ChatMessage[] | Omit<ChatMessage, "role">[],
  systemPrompt: string,
  options?: { model?: string; source?: string; langfusePrompt?: { name: string; version: number; isFallback?: boolean } }
) => Promise<ChatResponse>;

type GetAllContextFn = () => Record<string, string> | Promise<Record<string, string>>;

type LangfuseScoreCreateFn = (params: Evaluation) => Promise<void>;

type ExtractJdMetadataFn = (
  jdContent: string,
  options?: { model?: string; chat?: ChatFn }
) => Promise<JdExtraction>;

type ScoreExtractionFn = (
  extraction: JdExtraction,
  rawJd: string,
  judgeModel: string,
  options?: { chat?: ChatFn }
) => Promise<ExtractionScore>;

export interface RunEvalCvOptions {
  outputRoot?: string;
  jdFiles: JdFile[];
  models: string[];
  chat?: ChatFn;
  judgeChat?: ChatFn;
  extractionCache?: Map<string, JdExtraction>;
  extractJdMetadata?: ExtractJdMetadataFn;
  scoreExtraction?: ScoreExtractionFn;
  getAllContext?: GetAllContextFn;
  langfuseScoreCreate?: LangfuseScoreCreateFn;
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

async function loadKbAsRecordAsync(getAllContext: GetAllContextFn): Promise<Record<string, string>> {
  const result = await getAllContext();
  if (typeof result === "string") {
    return { "knowledge-base.md": result };
  }
  return result;
}

async function pushScores(
  langfuseScoreCreate: LangfuseScoreCreateFn | undefined,
  scores: EvalScoresPayload,
  warnings: string[]
): Promise<void> {
  if (!langfuseScoreCreate) return;

  const entries: Array<{ name: string; value: number; comment?: string }> = [
    { name: EvalDimension.FORMAT, value: scores.format.score, comment: scores.format.details.join("; ") },
    { name: EvalDimension.RELEVANCE, value: scores.relevance.score, comment: scores.relevance.reasoning },
    {
      name: EvalDimension.HALLUCINATION,
      value: scores.hallucination.score,
      comment: scores.hallucination.flaggedClaims.join("; ") || "No flagged claims",
    },
    {
      name: EvalDimension.EXTRACTION,
      value: scores.extraction.score,
      comment: scores.extraction.gaps.join("; ") || scores.extraction.reasoning,
    },
  ];

  for (const entry of entries) {
    try {
      await langfuseScoreCreate({
        name: entry.name,
        value: entry.value,
        dataType: "NUMERIC",
        comment: entry.comment,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Langfuse score push failed for ${entry.name}: ${message}`);
    }
  }
}

function writeExtractionArtifact(
  outputRoot: string,
  jdSlug: string,
  extraction: JdExtraction,
  extractionScore: ExtractionScore
): void {
  const jdDir = path.join(outputRoot, jdSlug);
  fs.mkdirSync(jdDir, { recursive: true });
  fs.writeFileSync(
    path.join(jdDir, "extraction.json"),
    JSON.stringify({ extraction, extractionScore }, null, 2),
    "utf-8"
  );
}

export async function runEvalCv(options: RunEvalCvOptions): Promise<RunEvalCvSummary> {
  const warnings: string[] = [];
  let completedPairs = 0;
  let failedPairs = 0;

  const outputRoot = options.outputRoot ?? path.join(process.cwd(), "eval-results");
  const chatFn = options.chat ?? chat;
  const judgeChatFn = options.judgeChat ?? chat;
  const getAllContext = options.getAllContext ?? (() => ({ "knowledge-base.md": getAllContextDefault() }));
  const extractFn = options.extractJdMetadata ?? extractJdMetadataDefault;
  const scoreExtractionFn = options.scoreExtraction ?? scoreExtractionDefault;
  const extractionCache = options.extractionCache ?? new Map<string, JdExtraction>();
  const extractionMinScore = getEvalExtractionMinScore();
  const extractionModel = getEvalExtractionModel();
  const extractionJudgeModel = resolveJudgeModel(extractionModel);

  if (options.jdFiles.length === 0) {
    warnings.push("No JD files loaded — nothing to evaluate");
    return { completedPairs: 0, failedPairs: 0, warnings };
  }

  const promptText = getCvPromptFallbackText();
  const kbFiles = await loadKbAsRecordAsync(getAllContext);

  for (const jd of options.jdFiles) {
    const rawJd = jd.content;
    let extraction: JdExtraction;
    let extractionScore: ExtractionScore;

    try {
      if (extractionCache.has(jd.slug)) {
        extraction = extractionCache.get(jd.slug)!;
      } else {
        extraction = await extractFn(rawJd, { model: extractionModel, chat: judgeChatFn });
        extractionCache.set(jd.slug, extraction);
      }

      extractionScore = await scoreExtractionFn(extraction, rawJd, extractionJudgeModel, {
        chat: judgeChatFn,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Extraction failed for ${jd.slug}: ${message}`);
      console.warn(`Skipping ${jd.slug} — extraction error:`, message);
      continue;
    }

    writeExtractionArtifact(outputRoot, jd.slug, extraction, extractionScore);

    if (extractionScore.parseFailed) {
      warnings.push(`parseFailed on extraction score for ${jd.slug}`);
    }

    if (options.langfuseScoreCreate) {
      try {
        await options.langfuseScoreCreate({
          name: EvalDimension.EXTRACTION,
          value: extractionScore.score,
          dataType: "NUMERIC",
          comment: extractionScore.reasoning,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Langfuse extraction score push failed for ${jd.slug}: ${message}`);
      }
    }

    if (!extractionScore.parseFailed && extractionScore.score < extractionMinScore) {
      warnings.push(
        `Skipped all models for ${jd.slug}: extraction score ${extractionScore.score} below threshold ${extractionMinScore}`
      );
      continue;
    }

    for (const model of options.models) {
      try {
        const context = Object.values(kbFiles).join("\n\n--\n\n");
        const systemPrompt = compileCvPrompt(promptText, context);

        const genStart = Date.now();
        const genResponse = await chatFn(
          [{ role: "user", content: `Tailor a CV for this job description:\n\n${rawJd}` }],
          systemPrompt,
          {
            model,
            source: "eval-cv-generation",
            langfusePrompt: { name: "cv-tailor-system", version: 0, isFallback: true },
          }
        );
        const genLatencyMs = Date.now() - genStart;

        const cvMarkdown = genResponse.content;
        const formatScore = scoreFormatCompliance(cvMarkdown);

        const judgeModel = resolveJudgeModel(model);
        const relevanceScore = await scoreRelevance(cvMarkdown, extraction, kbFiles, judgeModel, {
          chat: judgeChatFn,
        });
        if (relevanceScore.parseFailed) {
          warnings.push(`parseFailed on relevance score for ${jd.slug} × ${model}`);
        }

        const hallucinationScore = await scoreHallucination(cvMarkdown, extraction, kbFiles, judgeModel, {
          chat: judgeChatFn,
        });
        if (hallucinationScore.parseFailed) {
          warnings.push(`parseFailed on hallucination score for ${jd.slug} × ${model}`);
        }

        const scores = buildScoresPayload({
          format: formatScore,
          relevance: relevanceScore,
          hallucination: hallucinationScore,
          extraction: extractionScore,
          metadata: {
            jdSlug: jd.slug,
            model,
            judgeModel,
            extractionJudgeModel,
          },
        });

        const usage = buildUsagePayload({
          promptTokens: genResponse.usage.promptTokens,
          completionTokens: genResponse.usage.completionTokens,
          totalTokens: genResponse.usage.totalTokens,
          latencyMs: genLatencyMs,
          model: genResponse.model,
        });

        const artifactDir = path.join(outputRoot, jd.slug, ...model.split("/"));
        fs.mkdirSync(artifactDir, { recursive: true });
        fs.writeFileSync(path.join(artifactDir, "raw-cv.md"), cvMarkdown, "utf-8");
        fs.writeFileSync(path.join(artifactDir, "scores.json"), JSON.stringify(scores, null, 2), "utf-8");
        fs.writeFileSync(path.join(artifactDir, "usage.json"), JSON.stringify(usage, null, 2), "utf-8");

        await pushScores(options.langfuseScoreCreate, scores, warnings);

        completedPairs++;
      } catch (error) {
        failedPairs++;
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed ${jd.slug} × ${model}: ${message}`);
        console.error(`Eval pair failed (${jd.slug} × ${model}):`, message);
      }
    }
  }

  return { completedPairs, failedPairs, warnings };
}

function loadTestJdsFromDisk(): JdFile[] {
  const dir = path.join(process.cwd(), "knowledge-base", "test-jds");
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({
      slug: path.basename(name, ".md"),
      content: fs.readFileSync(path.join(dir, name), "utf-8"),
    }));
}

async function main(): Promise<void> {
  const jdFiles = loadTestJdsFromDisk();
  const models = parseEvalModels();

  const langfuse = initLangFuse();
  const langfuseScoreCreate = langfuse
    ? async (params: Evaluation) => langfuse.score.create(params)
    : undefined;

  console.log(`Evaluating ${jdFiles.length} JD(s) × ${models.length} model(s)...`);

  const summary = await runEvalCv({
    jdFiles,
    models,
    langfuseScoreCreate,
  });

  console.log("\n--- Eval Summary ---");
  console.log(`Completed: ${summary.completedPairs}`);
  console.log(`Failed: ${summary.failedPairs}`);
  if (summary.warnings.length > 0) {
    console.log("Warnings:");
    for (const w of summary.warnings) {
      console.log(`  - ${w}`);
    }
  }

  await flushLangfuseTraces();
}

if (require.main === module || process.argv[1]?.endsWith("eval-cv.ts")) {
  main().catch((err) => {
    console.error("eval-cv failed:", err);
    process.exit(1);
  });
}
