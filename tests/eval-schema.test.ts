import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EvalDimension,
  FormatSection,
  DEFAULT_EVAL_EXTRACTION_MIN_SCORE,
  DEFAULT_EVAL_MODELS_CSV,
  CANDIDATE_GENERATION_MODELS,
  type FormatScore,
  type RelevanceScore,
  type HallucinationScore,
  type ExtractionScore,
  type JdExtraction,
  type JdRequirement,
} from "../app/api/lib/eval-schema";

const STRUAN_EIGHT_PART_SECTIONS = [
  "Contact Information",
  "Objective Value Statement",
  "Relevant Accomplishments",
  "Technical Skills",
  "Standard Job Information",
  "Company Summaries",
  "Measurable Accomplishments",
  "Education",
] as const;

const EXPECTED_CANDIDATE_MODELS = [
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

describe("eval-schema — FormatSection enum", () => {
  it("values match the 8 canonical Struan sections in correct order", () => {
    const sections = Object.values(FormatSection);
    assert.equal(sections.length, 8);
    for (let i = 0; i < STRUAN_EIGHT_PART_SECTIONS.length; i++) {
      assert.equal(sections[i], STRUAN_EIGHT_PART_SECTIONS[i]);
    }
  });
});

describe("eval-schema — EvalDimension enum", () => {
  it("has exactly four members: FORMAT, RELEVANCE, HALLUCINATION, EXTRACTION", () => {
    const dimensions = Object.values(EvalDimension);
    assert.equal(dimensions.length, 4);
    assert.ok(dimensions.includes(EvalDimension.FORMAT));
    assert.ok(dimensions.includes(EvalDimension.RELEVANCE));
    assert.ok(dimensions.includes(EvalDimension.HALLUCINATION));
    assert.ok(dimensions.includes(EvalDimension.EXTRACTION));
  });
});

describe("eval-schema — score type interfaces", () => {
  it("FormatScore is correctly shaped", () => {
    const sample = {
      score: 1.0,
      breakdown: { "Contact Information": true },
      details: ["all sections present"],
    } satisfies FormatScore;
    assert.equal(typeof sample.score, "number");
    assert.equal(typeof sample.breakdown, "object");
    assert.ok(Array.isArray(sample.details));
  });

  it("RelevanceScore is correctly shaped", () => {
    const sample = {
      score: 4,
      reasoning: "Strong alignment with extracted requirements.",
      parseFailed: false,
    } satisfies RelevanceScore;
    assert.ok(sample.score >= 1 && sample.score <= 5);
    assert.equal(typeof sample.reasoning, "string");
  });

  it("HallucinationScore is correctly shaped", () => {
    const sample = {
      score: 0.0,
      flaggedClaims: ["Invented revenue figure"],
      parseFailed: false,
    } satisfies HallucinationScore;
    assert.ok(sample.score >= 0 && sample.score <= 1);
    assert.ok(Array.isArray(sample.flaggedClaims));
  });

  it("ExtractionScore is correctly shaped", () => {
    const sample = {
      score: 0.85,
      reasoning: "Requirements captured with minor keyword gaps.",
      gaps: ["Missing certification keyword"],
      parseFailed: false,
    } satisfies ExtractionScore;
    assert.ok(sample.score >= 0 && sample.score <= 1);
    assert.equal(typeof sample.reasoning, "string");
    assert.ok(Array.isArray(sample.gaps));
  });
});

describe("eval-schema — JdExtraction and JdRequirement types", () => {
  it("JdRequirement compiles with statement, weight, and keywords", () => {
    const requirement = {
      statement: "6+ years TypeScript experience",
      weight: "Must-Have",
      keywords: ["TypeScript", "JavaScript"],
    } satisfies JdRequirement;
    assert.equal(requirement.weight, "Must-Have");
    assert.ok(requirement.keywords.length > 0);
  });

  it("JdExtraction compiles with all fields from jd-prompt and Claude project taxonomy", () => {
    const extraction = {
      requirements: [
        {
          statement: "React and Node.js proficiency",
          weight: "Must-Have",
          keywords: ["React", "Node.js"],
        },
        {
          statement: "GraphQL experience",
          weight: "Nice-to-Have",
          keywords: ["GraphQL"],
        },
      ],
      hiringContext: "Hypergrowth",
      roleType: "Full-stack",
      topTechnologies: ["React", "Node.js", "TypeScript"],
      primaryResponsibilities: ["Ship features end-to-end", "Own API design"],
      title: "Senior Full-Stack Engineer",
      seniority: "IC",
      domainKnowledge: ["SaaS", "web applications"],
      keyVerbs: ["design", "implement", "ship"],
      implicitSuccessSignals: ["Mentors junior engineers", "Drives RFC process"],
      keywordBank: {
        mustHaves: ["TypeScript", "React"],
        tools: ["Next.js", "PostgreSQL"],
        certifications: ["AWS Solutions Architect"],
        verbs: ["build", "deploy", "optimize"],
      },
      rawJd: "We are hiring a senior full-stack engineer with React experience.",
      parseFailed: false,
    } satisfies JdExtraction;

    assert.ok(extraction.requirements.length >= 2);
    assert.equal(typeof extraction.title, "string");
    assert.equal(typeof extraction.hiringContext, "string");
    assert.ok(extraction.topTechnologies.length <= 3);
    assert.ok(extraction.keywordBank.mustHaves!.length > 0);
    assert.equal(typeof extraction.rawJd, "string");
  });
});

describe("eval-schema — candidate generation models", () => {
  it("CANDIDATE_GENERATION_MODELS lists all eval models", () => {
    assert.deepEqual([...CANDIDATE_GENERATION_MODELS].sort(), [...EXPECTED_CANDIDATE_MODELS].sort());
  });

  it("DEFAULT_EVAL_MODELS_CSV matches CANDIDATE_GENERATION_MODELS", () => {
    assert.equal(DEFAULT_EVAL_MODELS_CSV, CANDIDATE_GENERATION_MODELS.join(","));
  });
});

describe("eval-schema — env var defaults", () => {
  it("DEFAULT_EVAL_EXTRACTION_MIN_SCORE defaults to 0.7 and is parseable as float", () => {
    assert.equal(DEFAULT_EVAL_EXTRACTION_MIN_SCORE, 0.7);
    assert.ok(Number.isFinite(DEFAULT_EVAL_EXTRACTION_MIN_SCORE));
    assert.ok(DEFAULT_EVAL_EXTRACTION_MIN_SCORE >= 0 && DEFAULT_EVAL_EXTRACTION_MIN_SCORE <= 1);
  });
});
