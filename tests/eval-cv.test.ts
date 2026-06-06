import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatResponse } from "../app/api/lib/llm";
import type { JdExtraction, ExtractionScore } from "../app/api/lib/eval-schema";
import {
  parseEvalModels,
  buildEvalArtifactDir,
  buildScoresPayload,
  buildUsagePayload,
  runEvalCv,
  DEFAULT_EVAL_MODELS,
} from "../scripts/eval-cv";

const MOCK_CV = `# Contact Information
City | email

# Relevant Accomplishments
- Tailored bullet

# Measurable Accomplishments
- Shipped feature`;

const RAW_JD_WITH_INLINE_DASHES =
  "---\nThis is NOT YAML frontmatter; it is literal recruiter copy.\n---\n\nWe need a platform SRE with Kubernetes experience.";

function buildSampleExtraction(rawJd: string): JdExtraction {
  return {
    parseFailed: false,
    requirements: [
      {
        statement: "Kubernetes platform experience",
        weight: "Must-Have",
        keywords: ["Kubernetes", "SRE"],
      },
    ],
    hiringContext: "Default",
    roleType: "Platform",
    topTechnologies: ["Kubernetes", "Terraform", "Linux"],
    primaryResponsibilities: ["Operate production platforms"],
    title: "Platform SRE",
    seniority: "IC",
    domainKnowledge: ["infrastructure"],
    keyVerbs: ["operate", "automate"],
    implicitSuccessSignals: ["Reduces incident MTTR"],
    keywordBank: {
      mustHaves: ["Kubernetes"],
      tools: ["Terraform"],
      certifications: [],
      verbs: ["automate"],
    },
    rawJd,
  };
}

function mockChatResponse(content: string): ChatResponse {
  return {
    content,
    usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    model: "deepseek/deepseek-v4-pro",
    finishReason: "stop",
  };
}

function mockJudgeJson(
  dimension: "relevance" | "hallucination" | "extraction"
): string {
  if (dimension === "relevance") {
    return JSON.stringify({ score: 4, reasoning: "Good match." });
  }
  if (dimension === "extraction") {
    return JSON.stringify({
      score: 0.9,
      reasoning: "Extraction complete.",
      gaps: [],
    });
  }
  return JSON.stringify({ score: 0.1, flaggedClaims: [] });
}

function scoreWithParseFailed<T extends { parseFailed: boolean }>(
  score: Omit<T, "parseFailed">
): T {
  return { ...score, parseFailed: false } as T;
}

describe("parseEvalModels", () => {
  const original = process.env.EVAL_MODELS;

  afterEach(() => {
    if (original === undefined) delete process.env.EVAL_MODELS;
    else process.env.EVAL_MODELS = original;
  });

  it("parses comma-separated EVAL_MODELS env var", () => {
    process.env.EVAL_MODELS =
      "deepseek/deepseek-v4-pro, anthropic/sonnet, openrouter/openai/gpt-5.4-mini";
    const models = parseEvalModels();
    assert.deepEqual(models, [
      "deepseek/deepseek-v4-pro",
      "anthropic/sonnet",
      "openrouter/openai/gpt-5.4-mini",
    ]);
  });

  it("returns DEFAULT_EVAL_MODELS when EVAL_MODELS is unset", () => {
    delete process.env.EVAL_MODELS;
    const models = parseEvalModels();
    assert.deepEqual(models, DEFAULT_EVAL_MODELS);
    assert.ok(models.length >= 2);
  });

  it("each parsed model is namespaced provider/model", () => {
    const models = parseEvalModels();
    for (const model of models) {
      assert.match(model, /^[a-z]+\/.+/);
    }
  });

  it("warns when EVAL_MODELS includes a model missing from JUDGE_MAP", () => {
    process.env.EVAL_MODELS = "deepseek/deepseek-v4-pro,unknown/provider-model";
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: unknown) => warnings.push(String(msg));
    try {
      parseEvalModels();
    } finally {
      console.warn = original;
    }
    assert.ok(warnings.some((w) => /unknown\/provider-model/.test(w) && /JUDGE_MAP/i.test(w)));
  });
});

describe("buildEvalArtifactDir", () => {
  it("generates eval-results/<jd-slug>/<model>/ path", () => {
    const dir = buildEvalArtifactDir("full-stack-engineer", "anthropic/sonnet");
    assert.match(dir, /eval-results[/\\]full-stack-engineer[/\\]anthropic[/\\]sonnet/);
  });

  it("sanitizes model slashes for filesystem safety", () => {
    const dir = buildEvalArtifactDir("platform-sre", "openrouter/openai/gpt-5.4-mini");
    assert.ok(!dir.includes("//"));
    assert.match(dir, /eval-results[/\\]platform-sre[/\\]/);
  });
});

describe("buildScoresPayload + buildUsagePayload", () => {
  it("scores.json schema includes all four eval dimensions including extraction", () => {
    const payload = buildScoresPayload({
      format: { score: 1.0, breakdown: {}, details: [] },
      relevance: scoreWithParseFailed({ score: 4, reasoning: "Aligned." }),
      hallucination: scoreWithParseFailed({ score: 0.0, flaggedClaims: [] }),
      extraction: scoreWithParseFailed({
        score: 0.85,
        reasoning: "Complete.",
        gaps: [],
      }),
      metadata: {
        jdSlug: "test-jd",
        model: "anthropic/sonnet",
        judgeModel: "deepseek/deepseek-v4-pro",
        extractionJudgeModel: "anthropic/sonnet",
      },
    });
    assert.equal(typeof payload.format.score, "number");
    assert.equal(typeof payload.relevance.score, "number");
    assert.ok(payload.relevance.score >= 1 && payload.relevance.score <= 5);
    assert.equal(typeof payload.hallucination.score, "number");
    assert.ok(payload.hallucination.score >= 0 && payload.hallucination.score <= 1);
    assert.equal(typeof payload.extraction.score, "number");
    assert.ok(payload.extraction.score >= 0 && payload.extraction.score <= 1);
    assert.ok(Array.isArray(payload.extraction.gaps));
    assert.equal(payload.metadata.jdSlug, "test-jd");
    assert.equal(typeof payload.metadata.extractionJudgeModel, "string");
  });

  it("usage.json contains token counts and latency fields", () => {
    const usage = buildUsagePayload({
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      latencyMs: 3200,
      model: "deepseek/deepseek-v4-pro",
    });
    assert.equal(usage.promptTokens, 1000);
    assert.equal(usage.completionTokens, 500);
    assert.equal(usage.totalTokens, 1500);
    assert.equal(typeof usage.latencyMs, "number");
    assert.equal(usage.model, "deepseek/deepseek-v4-pro");
  });
});

describe("runEvalCv — integration with mocks", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cv-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("writes raw-cv.md, scores.json, and usage.json to correct artifact paths", async () => {
    const extraction = buildSampleExtraction("Build React apps for our platform.");
    const summary = await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "sample-jd", content: "Build React apps for our platform." }],
      models: ["anthropic/sonnet"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async (_messages, _system, opts) => {
        const source = String(opts?.source ?? "");
        const dimension = source.includes("hallucination")
          ? "hallucination"
          : source.includes("extraction")
            ? "extraction"
            : "relevance";
        return mockChatResponse(mockJudgeJson(dimension));
      },
      extractJdMetadata: async (jdContent) => ({ ...extraction, rawJd: jdContent }),
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.9,
          reasoning: "Good extraction.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({ "experience.md": "Example experience" }),
    });

    assert.equal(summary.completedPairs, 1);
    const artifactDir = path.join(tempRoot, "sample-jd", "anthropic", "sonnet");
    assert.ok(fs.existsSync(path.join(artifactDir, "raw-cv.md")));
    assert.ok(fs.existsSync(path.join(artifactDir, "scores.json")));
    assert.ok(fs.existsSync(path.join(artifactDir, "usage.json")));

    const scores = JSON.parse(
      fs.readFileSync(path.join(artifactDir, "scores.json"), "utf-8")
    );
    assert.equal(typeof scores.format.score, "number");
    assert.equal(typeof scores.relevance.score, "number");
    assert.equal(typeof scores.hallucination.score, "number");
    assert.equal(typeof scores.extraction.score, "number");
  });

  it("writes extraction.json at JD level with extraction payload and score", async () => {
    const rawJd = "Platform SRE with Kubernetes.";
    const extraction = buildSampleExtraction(rawJd);
    await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "platform-jd", content: rawJd }],
      models: ["anthropic/sonnet"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async (_m, _s, opts) =>
        mockChatResponse(
          mockJudgeJson(
            String(opts?.source ?? "").includes("extraction") ? "extraction" : "relevance"
          )
        ),
      extractJdMetadata: async () => extraction,
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.88,
          reasoning: "Captured requirements.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });

    const extractionPath = path.join(tempRoot, "platform-jd", "extraction.json");
    assert.ok(fs.existsSync(extractionPath), "extraction.json must be written at JD level");
    const payload = JSON.parse(fs.readFileSync(extractionPath, "utf-8"));
    assert.equal(typeof payload.extraction, "object");
    assert.ok(Array.isArray(payload.extraction.requirements));
    assert.equal(typeof payload.extractionScore.score, "number");
  });

  it("calls extractJdMetadata once per JD across multiple models", async () => {
    let extractCalls = 0;
    const extraction = buildSampleExtraction("Shared JD for two models.");
    const summary = await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "shared-jd", content: "Shared JD for two models." }],
      models: ["anthropic/sonnet", "deepseek/deepseek-v4-pro"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async (_m, _s, opts) =>
        mockChatResponse(
          mockJudgeJson(
            String(opts?.source ?? "").includes("hallucination")
              ? "hallucination"
              : String(opts?.source ?? "").includes("extraction")
                ? "extraction"
                : "relevance"
          )
        ),
      extractJdMetadata: async () => {
        extractCalls++;
        return extraction;
      },
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.95,
          reasoning: "Complete.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });

    assert.equal(extractCalls, 1);
    assert.equal(summary.completedPairs, 2);
  });

  it("uses injected extractionCache without re-extracting", async () => {
    let extractCalls = 0;
    const cached = buildSampleExtraction("Cached JD content.");
    const cache = new Map<string, JdExtraction>([["cached-jd", cached]]);

    await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "cached-jd", content: "Cached JD content." }],
      models: ["anthropic/sonnet"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async () => mockChatResponse(mockJudgeJson("relevance")),
      extractionCache: cache,
      extractJdMetadata: async () => {
        extractCalls++;
        return cached;
      },
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.9,
          reasoning: "Cached.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });

    assert.equal(extractCalls, 0);
  });

  it("skips all model evaluations when extraction score is below threshold", async () => {
    const originalMin = process.env.EVAL_EXTRACTION_MIN_SCORE;
    process.env.EVAL_EXTRACTION_MIN_SCORE = "0.7";

    try {
      let generationCalls = 0;
      const summary = await runEvalCv({
        outputRoot: tempRoot,
        jdFiles: [{ slug: "low-extraction", content: "Low quality extraction JD." }],
        models: ["anthropic/sonnet", "deepseek/deepseek-v4-pro"],
        chat: async () => {
          generationCalls++;
          return mockChatResponse(MOCK_CV);
        },
        judgeChat: async () => mockChatResponse(mockJudgeJson("relevance")),
        extractJdMetadata: async (jd) => buildSampleExtraction(jd),
        scoreExtraction: async (): Promise<ExtractionScore> =>
          scoreWithParseFailed({
            score: 0.4,
            reasoning: "Incomplete extraction.",
            gaps: ["Missing requirements"],
          }),
        langfuseScoreCreate: async () => {},
        getAllContext: async () => ({}),
      });

      assert.equal(summary.completedPairs, 0);
      assert.equal(generationCalls, 0);
      assert.ok(summary.warnings.some((w) => /extraction|threshold|skip/i.test(w)));
      assert.ok(
        fs.existsSync(path.join(tempRoot, "low-extraction", "extraction.json")),
        "extraction.json should still be written for skipped JD"
      );
    } finally {
      if (originalMin === undefined) delete process.env.EVAL_EXTRACTION_MIN_SCORE;
      else process.env.EVAL_EXTRACTION_MIN_SCORE = originalMin;
    }
  });

  it("uses raw JD content without stripping inline dash blocks", async () => {
    let capturedPrompt = "";
    const extraction = buildSampleExtraction(RAW_JD_WITH_INLINE_DASHES);

    await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "raw-jd", content: RAW_JD_WITH_INLINE_DASHES }],
      models: ["anthropic/sonnet"],
      chat: async (messages) => {
        capturedPrompt = String(messages[0]?.content ?? "");
        return mockChatResponse(MOCK_CV);
      },
      judgeChat: async () => mockChatResponse(mockJudgeJson("relevance")),
      extractJdMetadata: async (jd) => ({ ...extraction, rawJd: jd }),
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.9,
          reasoning: "OK.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });

    assert.ok(
      capturedPrompt.includes("NOT YAML frontmatter"),
      "raw JD must not be stripped by frontmatter parser"
    );
    assert.ok(capturedPrompt.includes("Kubernetes experience"));
  });

  it("continues run when extraction fails for one JD but succeeds for another", async () => {
    const summary = await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [
        { slug: "fail-extract", content: "JD that fails extraction." },
        { slug: "ok-extract", content: "JD that succeeds." },
      ],
      models: ["anthropic/sonnet"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async () => mockChatResponse(mockJudgeJson("relevance")),
      extractJdMetadata: async (jd) => {
        if (jd.includes("fails")) {
          throw new Error("Extraction LLM timeout");
        }
        return buildSampleExtraction(jd);
      },
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.9,
          reasoning: "OK.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });

    assert.equal(summary.completedPairs, 1);
    assert.ok(summary.warnings.some((w) => /fail-extract|extraction/i.test(w)));
    assert.ok(
      fs.existsSync(path.join(tempRoot, "ok-extract", "anthropic", "sonnet", "scores.json"))
    );
  });

  it("attempts Langfuse score push for all four dimensions including extraction", async () => {
    const scoreCalls: string[] = [];
    await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "langfuse-jd", content: "SRE role with observability focus." }],
      models: ["deepseek/deepseek-v4-pro"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async (_m, _s, opts) =>
        mockChatResponse(
          mockJudgeJson(
            String(opts?.source ?? "").includes("extraction") ? "extraction" : "relevance"
          )
        ),
      extractJdMetadata: async (jd) => buildSampleExtraction(jd),
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.92,
          reasoning: "Complete.",
          gaps: [],
        }),
      langfuseScoreCreate: async (params) => {
        scoreCalls.push(String(params.name));
      },
      getAllContext: async () => ({}),
    });

    assert.ok(scoreCalls.includes("format") || scoreCalls.includes("FORMAT"));
    assert.ok(scoreCalls.some((n) => /relevance/i.test(n)));
    assert.ok(scoreCalls.some((n) => /hallucination/i.test(n)));
    assert.ok(scoreCalls.some((n) => /extraction/i.test(n)));
  });

  it("warns and exits cleanly when JD list is empty", async () => {
    const summary = await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [],
      models: ["anthropic/sonnet"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async () => mockChatResponse(mockJudgeJson("relevance")),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });
    assert.equal(summary.completedPairs, 0);
    assert.ok(summary.warnings.length > 0);
  });

  it("continues to next pair when LLM generation fails for one pair", async () => {
    let callCount = 0;
    const summary = await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [
        { slug: "fail-jd", content: "JD A with React requirements." },
        { slug: "ok-jd", content: "JD B with Node requirements." },
      ],
      models: ["anthropic/sonnet"],
      chat: async () => {
        callCount++;
        if (callCount === 1) throw new Error("LLM timeout");
        return mockChatResponse(MOCK_CV);
      },
      judgeChat: async () => mockChatResponse(mockJudgeJson("relevance")),
      extractJdMetadata: async (jd) => buildSampleExtraction(jd),
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.9,
          reasoning: "OK.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });
    assert.equal(summary.completedPairs, 1);
    assert.equal(summary.failedPairs, 1);
  });

  it("writes artifacts even when Langfuse is unavailable", async () => {
    const summary = await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "no-langfuse", content: "JD C with platform focus." }],
      models: ["anthropic/sonnet"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async () => mockChatResponse(mockJudgeJson("relevance")),
      extractJdMetadata: async (jd) => buildSampleExtraction(jd),
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.9,
          reasoning: "OK.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {
        throw new Error("Langfuse unavailable");
      },
      getAllContext: async () => ({}),
    });
    assert.equal(summary.completedPairs, 1);
    assert.ok(summary.warnings.some((w) => /langfuse/i.test(w)));
    const artifactDir = path.join(tempRoot, "no-langfuse", "anthropic", "sonnet");
    assert.ok(fs.existsSync(path.join(artifactDir, "scores.json")));
  });

  it("surfaces parseFailed warning for extraction score but still writes scores.json", async () => {
    const summary = await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "parse-fail-extract", content: "Platform engineer role." }],
      models: ["anthropic/sonnet"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async () => mockChatResponse(mockJudgeJson("relevance")),
      extractJdMetadata: async (jd) => buildSampleExtraction(jd),
      scoreExtraction: async () => ({
        score: 0.5,
        reasoning: "Parse failure: invalid JSON",
        gaps: [],
        parseFailed: true,
      }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });

    assert.ok(
      summary.warnings.some((w) => /parseFailed on extraction score for parse-fail-extract/i.test(w))
    );
    const scoresPath = path.join(
      tempRoot,
      "parse-fail-extract",
      "anthropic",
      "sonnet",
      "scores.json"
    );
    assert.ok(fs.existsSync(scoresPath));
    const scores = JSON.parse(fs.readFileSync(scoresPath, "utf-8"));
    assert.equal(scores.extraction.parseFailed, true);
  });

  it("surfaces parseFailed warning for relevance score", async () => {
    const summary = await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "parse-fail-relevance", content: "Backend engineer role." }],
      models: ["anthropic/sonnet"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async (_m, _s, opts) => {
        const source = String(opts?.source ?? "");
        if (source.includes("relevance")) {
          return mockChatResponse("not valid json");
        }
        return mockChatResponse(mockJudgeJson("hallucination"));
      },
      extractJdMetadata: async (jd) => buildSampleExtraction(jd),
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.9,
          reasoning: "OK.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });

    assert.ok(
      summary.warnings.some((w) =>
        /parseFailed on relevance score for parse-fail-relevance × anthropic\/sonnet/i.test(w)
      )
    );
    const scores = JSON.parse(
      fs.readFileSync(
        path.join(tempRoot, "parse-fail-relevance", "anthropic", "sonnet", "scores.json"),
        "utf-8"
      )
    );
    assert.equal(scores.relevance.parseFailed, true);
  });

  it("surfaces parseFailed warning for hallucination score", async () => {
    const summary = await runEvalCv({
      outputRoot: tempRoot,
      jdFiles: [{ slug: "parse-fail-hallucination", content: "Data engineer role." }],
      models: ["deepseek/deepseek-v4-pro"],
      chat: async () => mockChatResponse(MOCK_CV),
      judgeChat: async (_m, _s, opts) => {
        const source = String(opts?.source ?? "");
        if (source.includes("hallucination")) {
          return mockChatResponse("```broken```");
        }
        return mockChatResponse(mockJudgeJson("relevance"));
      },
      extractJdMetadata: async (jd) => buildSampleExtraction(jd),
      scoreExtraction: async () =>
        scoreWithParseFailed({
          score: 0.9,
          reasoning: "OK.",
          gaps: [],
        }),
      langfuseScoreCreate: async () => {},
      getAllContext: async () => ({}),
    });

    assert.ok(
      summary.warnings.some((w) =>
        /parseFailed on hallucination score for parse-fail-hallucination × deepseek\/deepseek-v4-pro/i.test(
          w
        )
      )
    );
    const scores = JSON.parse(
      fs.readFileSync(
        path.join(
          tempRoot,
          "parse-fail-hallucination",
          "deepseek",
          "deepseek-v4-pro",
          "scores.json"
        ),
        "utf-8"
      )
    );
    assert.equal(scores.hallucination.parseFailed, true);
  });
});
