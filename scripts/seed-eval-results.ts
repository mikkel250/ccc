#!/usr/bin/env npx tsx
/**
 * Seeds eval-results/ with deterministic mock artifacts for all JD×model pairs.
 * Used when live LLM eval cannot run (no API keys in CI).
 */

import fs from "node:fs";
import path from "node:path";
import { parseEvalModels, buildScoresPayload, buildUsagePayload } from "../app/api/lib/eval-cv-helpers";

const EVAL_RESULTS_DIR = path.join(process.cwd(), "eval-results");
const TEST_JDS_DIR = path.join(process.cwd(), "knowledge-base", "test-jds");

const CANONICAL_CV = `# Jane Example

## Contact Information
San Francisco, CA | email@example.com

## Objective Value Statement
10+ years building full-stack platforms at growth-stage companies.

## Relevant Accomplishments
- Led migration to React
- Reduced deploy time 40%

## Technical Skills
TypeScript, React, Node.js, PostgreSQL

## Standard Job Information
### Acme Corp
Senior Engineer | Remote | Jan 2020 – Present

## Company Summaries
Acme Corp — B2B SaaS, ~200 employees, US/EU.

## Measurable Accomplishments
- Shipped billing revamp used by 5k accounts

## Education
BS Computer Science, Example University
`;

const MODEL_SCORES: Record<
  string,
  { format: number; relevance: number; hallucination: number; extraction: number }
> = {
  "anthropic/sonnet": { format: 1.0, relevance: 5, hallucination: 0.05, extraction: 0.92 },
  "deepseek/deepseek-v4-pro": { format: 0.95, relevance: 4, hallucination: 0.15, extraction: 0.88 },
  "openrouter/openai/gpt-5.4-mini": { format: 0.9, relevance: 4, hallucination: 0.2, extraction: 0.85 },
  "openrouter/google/gemini-2.5-pro": { format: 0.88, relevance: 4, hallucination: 0.25, extraction: 0.82 },
};

const SAMPLE_EXTRACTION = {
  requirements: [
    {
      statement: "Strong proficiency in TypeScript and React",
      weight: "Must-Have" as const,
      keywords: ["TypeScript", "React"],
    },
  ],
  hiringContext: "Default",
  roleType: "Full-stack",
  topTechnologies: ["TypeScript", "React", "Node.js"],
  primaryResponsibilities: ["Ship features end-to-end"],
  title: "Senior Engineer",
  seniority: "IC",
  domainKnowledge: ["SaaS"],
  keyVerbs: ["build", "ship"],
  implicitSuccessSignals: ["Mentors engineers"],
  keywordBank: {
    mustHaves: ["TypeScript", "React"],
    tools: ["Node.js"],
    certifications: [],
    verbs: ["build"],
  },
};

function listJdSlugs(): string[] {
  return fs
    .readdirSync(TEST_JDS_DIR)
    .filter((n) => n.endsWith(".md"))
    .map((n) => path.basename(n, ".md"));
}

function readJdContent(slug: string): string {
  return fs.readFileSync(path.join(TEST_JDS_DIR, `${slug}.md`), "utf-8");
}

function main(): void {
  const slugs = listJdSlugs();
  const models = parseEvalModels();

  for (const slug of slugs) {
    const rawJd = readJdContent(slug);
    const jdDir = path.join(EVAL_RESULTS_DIR, slug);
    fs.mkdirSync(jdDir, { recursive: true });

    const extractionPayload = {
      extraction: { ...SAMPLE_EXTRACTION, rawJd },
      extractionScore: {
        score: 0.9,
        reasoning: "Seeded extraction score.",
        gaps: [],
      },
    };
    fs.writeFileSync(
      path.join(jdDir, "extraction.json"),
      JSON.stringify(extractionPayload, null, 2),
      "utf-8"
    );

    for (const model of models) {
      const scores = MODEL_SCORES[model] ?? {
        format: 0.8,
        relevance: 3,
        hallucination: 0.3,
        extraction: 0.75,
      };
      const dir = path.join(EVAL_RESULTS_DIR, slug, ...model.split("/"));
      fs.mkdirSync(dir, { recursive: true });

      const payload = buildScoresPayload({
        format: {
          score: scores.format,
          breakdown: {},
          details: ["Seeded eval artifact"],
        },
        relevance: { score: scores.relevance, reasoning: "Seeded eval score.", parseFailed: false },
        hallucination: { score: scores.hallucination, flaggedClaims: [], parseFailed: false },
        extraction: {
          score: scores.extraction,
          reasoning: "Seeded extraction score.",
          gaps: [],
          parseFailed: false,
        },
        metadata: {
          jdSlug: slug,
          model,
          judgeModel: "anthropic/sonnet",
          extractionJudgeModel: "deepseek/deepseek-v4-pro",
        },
      });

      const usage = buildUsagePayload({
        promptTokens: 12000,
        completionTokens: 3500,
        totalTokens: 15500,
        latencyMs: 8500,
        model,
      });

      fs.writeFileSync(path.join(dir, "raw-cv.md"), CANONICAL_CV, "utf-8");
      fs.writeFileSync(path.join(dir, "scores.json"), JSON.stringify(payload, null, 2), "utf-8");
      fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify(usage, null, 2), "utf-8");
    }
  }

  console.log(`Seeded ${slugs.length} JD(s) × ${models.length} model(s) in eval-results/`);
}

main();
