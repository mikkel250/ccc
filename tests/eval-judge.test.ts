import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { ChatResponse } from "../app/api/lib/llm";
import type { JdExtraction } from "../app/api/lib/eval-schema";
import {
  EXTRACTION_JUDGE_PROMPT,
  RELEVANCE_JUDGE_PROMPT,
  HALLUCINATION_JUDGE_PROMPT,
} from "../app/api/lib/eval-schema";
import {
  scoreRelevance,
  scoreHallucination,
  scoreExtraction,
  resolveJudgeModel,
} from "../app/api/lib/eval-judge";
import { extractStructuredJson } from "../app/api/lib/eval-parse";
import {
  CANDIDATE_GENERATION_MODELS,
  DEFAULT_EVAL_EXTRACTION_MODEL,
  JUDGE_MAP,
  warnUnmappedJudgeModels,
} from "../app/api/lib/eval-schema";

const SAMPLE_CV = `# Relevant Accomplishments
- Built React dashboards

# Measurable Accomplishments
- Reduced latency 30%`;

const SAMPLE_RAW_JD =
  "Acme Corp is hiring a Senior Full-Stack Engineer with React and Node.js experience.";

const SAMPLE_KB: Record<string, string> = {
  "experience.md": "Worked at Example Corp as Senior Engineer.",
};

function buildSampleExtraction(overrides: Partial<JdExtraction> = {}): JdExtraction {
  return {
    parseFailed: false,
    requirements: [
      {
        statement: "React and Node.js proficiency",
        weight: "Must-Have",
        keywords: ["React", "Node.js"],
      },
    ],
    hiringContext: "Default",
    roleType: "Full-stack",
    topTechnologies: ["React", "Node.js", "TypeScript"],
    primaryResponsibilities: ["Ship full-stack features"],
    title: "Senior Full-Stack Engineer",
    seniority: "IC",
    domainKnowledge: ["web applications"],
    keyVerbs: ["build", "ship"],
    implicitSuccessSignals: ["Mentors engineers"],
    keywordBank: {
      mustHaves: ["React", "TypeScript"],
      tools: ["Next.js"],
      certifications: [],
      verbs: ["build"],
    },
    rawJd: SAMPLE_RAW_JD,
    ...overrides,
  };
}

function mockChatResponse(content: string, model = "anthropic/sonnet"): ChatResponse {
  return {
    content,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model,
    finishReason: "stop",
  };
}

describe("extractStructuredJson", () => {
  it("parses plain JSON object", () => {
    const result = extractStructuredJson('{"score": 4, "reasoning": "Good"}');
    assert.deepEqual(result, { score: 4, reasoning: "Good" });
  });

  it("parses JSON inside markdown code fences", () => {
    const result = extractStructuredJson(
      'Here is the result:\n```json\n{"score": 3, "reasoning": "OK"}\n```'
    );
    assert.deepEqual(result, { score: 3, reasoning: "OK" });
  });

  it("parses JSON with trailing explanatory text", () => {
    const result = extractStructuredJson(
      '{"score": 0.2, "flaggedClaims": ["fake metric"]}\n\nNote: minor rephrasing allowed.'
    );
    assert.equal((result as { score: number }).score, 0.2);
    assert.deepEqual((result as { flaggedClaims: string[] }).flaggedClaims, [
      "fake metric",
    ]);
  });

  it("throws on empty response", () => {
    assert.throws(() => extractStructuredJson(""), /empty|json|parse/i);
  });

  it("throws on non-JSON response", () => {
    assert.throws(
      () => extractStructuredJson("This is not JSON at all."),
      /json|parse/i
    );
  });
});

describe("resolveJudgeModel", () => {
  const originalJudgeModel = process.env.EVAL_JUDGE_MODEL;

  afterEach(() => {
    if (originalJudgeModel === undefined) delete process.env.EVAL_JUDGE_MODEL;
    else process.env.EVAL_JUDGE_MODEL = originalJudgeModel;
  });

  it("returns a different-provider judge for deepseek/deepseek-v4-pro", () => {
    const judge = resolveJudgeModel("deepseek/deepseek-v4-pro");
    assert.notEqual(judge.split("/")[0], "deepseek");
    assert.match(judge, /^[a-z]+\/.+/);
  });

  it("returns a different-provider judge for anthropic/sonnet", () => {
    const judge = resolveJudgeModel("anthropic/sonnet");
    assert.notEqual(judge.split("/")[0], "anthropic");
  });

  it("returns a different-provider judge for openrouter/openai/gpt-5.4-mini", () => {
    const judge = resolveJudgeModel("openrouter/openai/gpt-5.4-mini");
    assert.notEqual(judge.split("/")[0], "openrouter");
  });

  it("returns a different-provider judge for openrouter/google/gemini-2.5-pro", () => {
    const judge = resolveJudgeModel("openrouter/google/gemini-2.5-pro");
    assert.notEqual(judge.split("/")[0], "openrouter");
  });

  it("falls back to EVAL_JUDGE_MODEL env var for unknown generator", () => {
    process.env.EVAL_JUDGE_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(resolveJudgeModel("unknown/provider-model"), "deepseek/deepseek-v4-pro");
  });

  it("resolves extraction model via JUDGE_MAP, not env fallback", () => {
    delete process.env.EVAL_JUDGE_MODEL;
    const judge = resolveJudgeModel(DEFAULT_EVAL_EXTRACTION_MODEL);
    assert.equal(judge, JUDGE_MAP[DEFAULT_EVAL_EXTRACTION_MODEL as keyof typeof JUDGE_MAP]);
    assert.notEqual(judge.split("/")[0], "openrouter");
  });

  it("covers every candidate generation model from eval schema", () => {
    for (const model of CANDIDATE_GENERATION_MODELS) {
      const judge = resolveJudgeModel(model);
      assert.notEqual(judge, model);
      assert.match(judge, /^[a-z]+\/.+/);
    }
  });
});

describe("warnUnmappedJudgeModels", () => {
  it("warns when a model has no JUDGE_MAP entry", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: unknown) => warnings.push(String(msg));
    try {
      warnUnmappedJudgeModels(["unknown/provider-model"]);
    } finally {
      console.warn = original;
    }
    assert.ok(warnings.some((w) => /JUDGE_MAP/i.test(w) && /unknown\/provider-model/.test(w)));
  });

  it("does not warn for mapped models", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: unknown) => warnings.push(String(msg));
    try {
      warnUnmappedJudgeModels([...CANDIDATE_GENERATION_MODELS, DEFAULT_EVAL_EXTRACTION_MODEL]);
    } finally {
      console.warn = original;
    }
    assert.equal(warnings.length, 0);
  });
});

describe("scoreExtraction — mock chat()", () => {
  it("parses valid extraction score 0.0–1.0 with reasoning and gaps", async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreExtraction(extraction, SAMPLE_RAW_JD, "anthropic/sonnet", {
      chat: async () =>
        mockChatResponse(
          JSON.stringify({
            score: 0.85,
            reasoning: "Requirements captured accurately.",
            gaps: ["Minor keyword omission"],
          })
        ),
    });
    assert.equal(result.score, 0.85);
    assert.match(result.reasoning, /accurate/i);
    assert.deepEqual(result.gaps, ["Minor keyword omission"]);
    assert.equal(result.parseFailed, false);
  });

  it("clamps scores below 0.0 and above 1.0", async () => {
    const extraction = buildSampleExtraction();
    for (const [raw, expected] of [
      [-0.5, 0],
      [1.5, 1],
    ] as const) {
      const result = await scoreExtraction(extraction, SAMPLE_RAW_JD, "anthropic/sonnet", {
        chat: async () =>
          mockChatResponse(
            JSON.stringify({ score: raw, reasoning: "Clamped.", gaps: [] })
          ),
      });
      assert.equal(result.score, expected);
    }
  });

  it("returns parseFailed true when LLM returns malformed JSON", async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreExtraction(extraction, SAMPLE_RAW_JD, "anthropic/sonnet", {
      chat: async () => mockChatResponse("not valid json {{{"),
    });
    assert.equal(result.parseFailed, true);
    assert.ok(result.score >= 0 && result.score <= 1);
    assert.match(result.reasoning, /error|parse|fail/i);
    assert.ok(Array.isArray(result.gaps));
  });

  it("does not include duplicate ## Raw Job Description block in user message", async () => {
    const extraction = buildSampleExtraction();
    let userMessage = "";
    await scoreExtraction(extraction, SAMPLE_RAW_JD, "anthropic/sonnet", {
      chat: async (messages) => {
        userMessage = String(messages[0]?.content ?? "");
        return mockChatResponse(
          JSON.stringify({ score: 0.9, reasoning: "Complete.", gaps: [] })
        );
      },
    });
    assert.doesNotMatch(userMessage, /## Raw Job Description/);
    assert.match(userMessage, /Structured Extraction/i);
    assert.ok(userMessage.includes(SAMPLE_RAW_JD));
  });

  it("scores empty extraction at or near 0.0", async () => {
    const emptyExtraction = buildSampleExtraction({
      requirements: [],
      keywordBank: { mustHaves: [], tools: [], certifications: [], verbs: [] },
      implicitSuccessSignals: [],
    });
    const result = await scoreExtraction(emptyExtraction, SAMPLE_RAW_JD, "anthropic/sonnet", {
      chat: async () =>
        mockChatResponse(
          JSON.stringify({
            score: 0.0,
            reasoning: "No requirements extracted.",
            gaps: ["All requirements missing"],
          })
        ),
    });
    assert.equal(result.score, 0.0);
    assert.ok(result.gaps.length > 0);
  });

  it("scores perfect extraction at 1.0 with no gaps", async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreExtraction(extraction, SAMPLE_RAW_JD, "anthropic/sonnet", {
      chat: async () =>
        mockChatResponse(
          JSON.stringify({
            score: 1.0,
            reasoning: "Complete and accurate extraction.",
            gaps: [],
          })
        ),
    });
    assert.equal(result.score, 1.0);
    assert.equal(result.gaps.length, 0);
  });

  it("lists gaps for partial extraction", async () => {
    const partial = buildSampleExtraction({
      requirements: [
        {
          statement: "React proficiency only",
          weight: "Must-Have",
          keywords: ["React"],
        },
      ],
    });
    const result = await scoreExtraction(partial, SAMPLE_RAW_JD, "anthropic/sonnet", {
      chat: async () =>
        mockChatResponse(
          JSON.stringify({
            score: 0.55,
            reasoning: "Partial coverage.",
            gaps: ["Node.js requirement missing", "Keyword bank incomplete"],
          })
        ),
    });
    assert.equal(result.score, 0.55);
    assert.equal(result.gaps.length, 2);
  });
});

describe("scoreExtraction — RUN_LLM_TESTS integration", () => {
  const runLive = process.env.RUN_LLM_TESTS === "true";

  it("live extraction scoring returns 0.0–1.0 with reasoning and gaps", { skip: !runLive }, async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreExtraction(
      extraction,
      SAMPLE_RAW_JD,
      resolveJudgeModel("openrouter/openai/gpt-4o-mini")
    );
    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(result.reasoning.length > 0);
    assert.ok(Array.isArray(result.gaps));
  });
});

describe("stage 2 judge prompts — structured extraction references", () => {
  it("relevance judge prompt references extracted requirements, not raw job description", () => {
    assert.match(RELEVANCE_JUDGE_PROMPT, /extracted requirements/i);
    assert.doesNotMatch(RELEVANCE_JUDGE_PROMPT, /raw job description/i);
  });

  it("hallucination judge prompt references extraction context alongside knowledge base", () => {
    assert.match(HALLUCINATION_JUDGE_PROMPT, /(extracted|requirements|keywords)/i);
    assert.match(HALLUCINATION_JUDGE_PROMPT, /knowledge base|ground truth/i);
  });

  it("extraction judge prompt assesses completeness and fabrication", () => {
    assert.match(EXTRACTION_JUDGE_PROMPT, /(requirements|keywords|implicit success)/i);
    assert.match(EXTRACTION_JUDGE_PROMPT, /(hallucinat|fabricat)/i);
  });
});

describe("scoreRelevance — mock chat() with JdExtraction", () => {
  it("parses valid relevance score 1–5 with reasoning", async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreRelevance(SAMPLE_CV, extraction, SAMPLE_KB, "anthropic/sonnet", {
      chat: async () =>
        mockChatResponse(JSON.stringify({ score: 4, reasoning: "Strong requirement alignment." })),
    });
    assert.equal(result.score, 4);
    assert.match(result.reasoning, /alignment/i);
    assert.equal(result.parseFailed, false);
  });

  it("includes extracted requirements in judge user message", async () => {
    const extraction = buildSampleExtraction();
    let userMessage = "";
    await scoreRelevance(SAMPLE_CV, extraction, SAMPLE_KB, "anthropic/sonnet", {
      chat: async (messages) => {
        userMessage = String(messages[0]?.content ?? "");
        return mockChatResponse(JSON.stringify({ score: 4, reasoning: "Aligned." }));
      },
    });
    assert.match(userMessage, /Extracted Requirements/i);
    assert.match(userMessage, /React and Node\.js proficiency/i);
    assert.match(userMessage, /Keywords/i);
    assert.match(userMessage, /Hiring Context/i);
    assert.doesNotMatch(userMessage, /## Job Description\n/);
  });

  it("accepts edge score values 1 and 5", async () => {
    const extraction = buildSampleExtraction();
    for (const score of [1, 5] as const) {
      const result = await scoreRelevance(SAMPLE_CV, extraction, SAMPLE_KB, "anthropic/sonnet", {
        chat: async () =>
          mockChatResponse(JSON.stringify({ score, reasoning: `Score ${score}` })),
      });
      assert.equal(result.score, score);
    }
  });

  it("returns parseFailed true when LLM returns malformed JSON", async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreRelevance(SAMPLE_CV, extraction, SAMPLE_KB, "anthropic/sonnet", {
      chat: async () => mockChatResponse("not valid json {{{"),
    });
    assert.equal(result.parseFailed, true);
    assert.ok(result.score >= 1 && result.score <= 5);
    assert.match(result.reasoning, /error|parse|fail/i);
  });

  it("handles empty CV input without throwing", async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreRelevance("", extraction, SAMPLE_KB, "anthropic/sonnet", {
      chat: async () =>
        mockChatResponse(JSON.stringify({ score: 2, reasoning: "No accomplishments." })),
    });
    assert.ok(result.score >= 1 && result.score <= 5);
  });

  it("handles empty extraction requirements without throwing", async () => {
    const extraction = buildSampleExtraction({ requirements: [] });
    const result = await scoreRelevance(SAMPLE_CV, extraction, SAMPLE_KB, "anthropic/sonnet", {
      chat: async () =>
        mockChatResponse(JSON.stringify({ score: 3, reasoning: "Neutral." })),
    });
    assert.ok(result.score >= 1 && result.score <= 5);
  });
});

describe("scoreHallucination — mock chat() with JdExtraction", () => {
  it("parses valid hallucination score 0.0–1.0 with flagged claims", async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreHallucination(
      SAMPLE_CV,
      extraction,
      SAMPLE_KB,
      "deepseek/deepseek-v4-pro",
      {
        chat: async () =>
          mockChatResponse(
            JSON.stringify({
              score: 0.25,
              flaggedClaims: ["Claimed 90% improvement not in KB"],
            })
          ),
      }
    );
    assert.equal(result.score, 0.25);
    assert.ok(Array.isArray(result.flaggedClaims));
    assert.equal(result.flaggedClaims.length, 1);
    assert.equal(result.parseFailed, false);
  });

  it("includes extraction context in judge user message while KB remains ground truth", async () => {
    const extraction = buildSampleExtraction();
    let userMessage = "";
    await scoreHallucination(SAMPLE_CV, extraction, SAMPLE_KB, "deepseek/deepseek-v4-pro", {
      chat: async (messages) => {
        userMessage = String(messages[0]?.content ?? "");
        return mockChatResponse(JSON.stringify({ score: 0.1, flaggedClaims: [] }));
      },
    });
    assert.match(userMessage, /Knowledge Base \(ground truth\)/i);
    assert.match(userMessage, /Extracted Requirements|Keywords|Hiring Context/i);
    assert.doesNotMatch(userMessage, /## Job Description\n/);
  });

  it("accepts edge score values 0.0 and 1.0", async () => {
    const extraction = buildSampleExtraction();
    for (const score of [0.0, 1.0] as const) {
      const result = await scoreHallucination(
        SAMPLE_CV,
        extraction,
        SAMPLE_KB,
        "deepseek/deepseek-v4-pro",
        {
          chat: async () =>
            mockChatResponse(
              JSON.stringify({ score, flaggedClaims: score === 0 ? [] : ["fabricated role"] })
            ),
        }
      );
      assert.equal(result.score, score);
    }
  });

  it("returns parseFailed true when LLM returns malformed JSON", async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreHallucination(
      SAMPLE_CV,
      extraction,
      SAMPLE_KB,
      "deepseek/deepseek-v4-pro",
      {
        chat: async () => mockChatResponse("```\nbroken\n```"),
      }
    );
    assert.equal(result.parseFailed, true);
    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(Array.isArray(result.flaggedClaims));
  });

  it("handles missing KB files without throwing", async () => {
    const extraction = buildSampleExtraction();
    const result = await scoreHallucination(SAMPLE_CV, extraction, {}, "deepseek/deepseek-v4-pro", {
      chat: async () =>
        mockChatResponse(JSON.stringify({ score: 0.5, flaggedClaims: ["unverified claim"] })),
    });
    assert.ok(result.score >= 0 && result.score <= 1);
  });
});

describe("scoreRelevance + scoreHallucination — RUN_LLM_TESTS integration", () => {
  const runLive = process.env.RUN_LLM_TESTS === "true";
  const extraction = buildSampleExtraction();

  it("live relevance scoring returns 1–5 with reasoning", { skip: !runLive }, async () => {
    const result = await scoreRelevance(
      SAMPLE_CV,
      extraction,
      SAMPLE_KB,
      resolveJudgeModel("deepseek/deepseek-v4-pro")
    );
    assert.ok(result.score >= 1 && result.score <= 5);
    assert.ok(result.reasoning.length > 0);
  });

  it("live hallucination scoring returns 0.0–1.0 with flaggedClaims array", { skip: !runLive }, async () => {
    const result = await scoreHallucination(
      SAMPLE_CV,
      extraction,
      SAMPLE_KB,
      resolveJudgeModel("anthropic/sonnet")
    );
    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(Array.isArray(result.flaggedClaims));
  });
});
