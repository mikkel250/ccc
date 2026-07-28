import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  critiqueCvDraft,
  isCritiqueResult,
  buildJudgeUserMessage,
  type CritiqueResult,
} from "../app/api/lib/adversarial-judge";

const MOCK_CRITIQUE: CritiqueResult = {
  narrativeCoherence: { score: 7, feedback: "Good flow but gap in mid-career." },
  skepticismPreemption: { score: 5, feedback: "Does not address domain switch explicitly." },
  overqualificationRisk: { score: 3, feedback: "Senior titles may signal flight risk." },
  atsViability: { score: 8, feedback: "Strong keyword coverage." },
  redFlags: ["Gap between 2019–2021 not explained."],
  hallucinationConcerns: [],
  overallAssessment: "Strong candidate but needs clearer narrative around pivot.",
};

const VALID_JUDGE_OUTPUT = JSON.stringify(MOCK_CRITIQUE);

function mockChatFn(output: string) {
  return mock.fn(async () => ({
    content: output,
    usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
    model: "openrouter/openai/gpt-4o-mini",
    finishReason: "stop",
  }));
}

function ensureEnv() {
  process.env.NODE_ENV = "test";
}

describe("critiqueCvDraft — adversarial judge", () => {
  beforeEach(() => {
    ensureEnv();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  const curatedCv = {
    name: "Test Candidate",
    experience: [
      { title: "Senior Engineer", dates: "2020–2023", bullets: ["Led team of 5"] },
    ],
    skills: [{ category: "Technical", items: "React, Node.js" }],
  };

  const jobDescription = "We need a senior engineer with React and Node.js experience.";

  it("returns a structured critique on successful LLM call", async () => {
    const chatFn = mockChatFn(VALID_JUDGE_OUTPUT);
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.critique.narrativeCoherence.score, "number");
      assert.equal(typeof result.critique.atsViability.score, "number");
      assert.ok(Array.isArray(result.critique.redFlags));
      assert.ok(Array.isArray(result.critique.hallucinationConcerns));
      assert.equal(typeof result.critique.overallAssessment, "string");
    }
  });

  it("includes alignment check for flexible mode", async () => {
    const critiqueWithAlignment = {
      ...MOCK_CRITIQUE,
      alignmentIssues: ["Cover letter claims 10 years in hospitality; CV shows 6."],
    };
    const chatFn = mockChatFn(JSON.stringify(critiqueWithAlignment));
    const result = await critiqueCvDraft(
      {
        curatedCv,
        jobDescription,
        curationMode: "flexible",
        coverLetter: "Experienced professional with strong leadership skills.",
      },
      { chat: chatFn }
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.critique.alignmentIssues);
      assert.equal(result.critique.alignmentIssues!.length, 1);
    }
  });

  it("parses markdown-fenced JSON judge output", async () => {
    const chatFn = mockChatFn("```json\n" + VALID_JUDGE_OUTPUT + "\n```");
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.critique.narrativeCoherence.score, "number");
    }
  });

  it("returns error when LLM output is not valid JSON", async () => {
    const chatFn = mockChatFn("not json");
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /judge output|parse|json/i);
    }
  });

  it("returns error when critique is missing required fields", async () => {
    const chatFn = mockChatFn(JSON.stringify({ narrativeCoherence: { score: 5 } }));
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /incomplete|missing/i);
    }
  });

  it("rejects critique with out-of-range dimension scores", async () => {
    const bad = { ...MOCK_CRITIQUE, narrativeCoherence: { score: 11, feedback: "too high" } };
    const chatFn = mockChatFn(JSON.stringify(bad));
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, false);
  });

  it("rejects critique with NaN dimension score", async () => {
    const bad = { ...MOCK_CRITIQUE, narrativeCoherence: { score: NaN, feedback: "NaN" } };
    const chatFn = mockChatFn(JSON.stringify(bad));
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, false);
  });

  it("rejects critique where alignmentIssues is not an array", async () => {
    const bad = { ...MOCK_CRITIQUE, alignmentIssues: "not-an-array" };
    const chatFn = mockChatFn(JSON.stringify(bad));
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, false);
  });

  it("rejects critique where redFlags contains non-strings", async () => {
    const bad = { ...MOCK_CRITIQUE, redFlags: ["valid", 42] };
    const chatFn = mockChatFn(JSON.stringify(bad));
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, false);
  });

  it("rejects critique where hallucinationConcerns contains non-strings", async () => {
    const bad = { ...MOCK_CRITIQUE, hallucinationConcerns: [null] };
    const chatFn = mockChatFn(JSON.stringify(bad));
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, false);
  });

  it("passes configured model when ADVERSARIAL_JUDGE_MODEL is set", async () => {
    process.env.ADVERSARIAL_JUDGE_MODEL = "openrouter/anthropic/claude-haiku";
    const chatFn = mockChatFn(VALID_JUDGE_OUTPUT);
    await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    const calls = chatFn.mock.calls as Array<{ arguments: unknown[] }>;
    assert.ok(calls.length > 0);
    const options = calls[0]?.arguments[2] as { model: string } | undefined;
    assert.ok(options?.model);
    assert.ok(options.model.includes("claude-haiku"));
    delete process.env.ADVERSARIAL_JUDGE_MODEL;
  });

  it("passes custom system prompt when ADVERSARIAL_JUDGE_PROMPT is set", async () => {
    const customPrompt = "Custom adversarial judge prompt for testing.";
    process.env.ADVERSARIAL_JUDGE_PROMPT = customPrompt;
    const chatFn = mockChatFn(VALID_JUDGE_OUTPUT);
    await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    const calls = chatFn.mock.calls as Array<{ arguments: unknown[] }>;
    assert.ok(calls.length > 0);
    const systemPrompt = calls[0]?.arguments[1] as string | undefined;
    assert.equal(systemPrompt, customPrompt);
    delete process.env.ADVERSARIAL_JUDGE_PROMPT;
  });

  it("passes cover letter to LLM in flexible mode", async () => {
    const chatFn = mockChatFn(VALID_JUDGE_OUTPUT);
    const coverLetter = "I am a seasoned leader transitioning into tech.";
    await critiqueCvDraft(
      {
        curatedCv,
        jobDescription,
        curationMode: "flexible",
        coverLetter,
      },
      { chat: chatFn }
    );
    const calls = chatFn.mock.calls as Array<{ arguments: unknown[] }>;
    assert.ok(calls.length > 0);
    const messages = calls[0]?.arguments[0] as Array<{ role: string; content: string }> | undefined;
    assert.ok(messages);
    const userMessage = messages[0]?.content ?? "";
    assert.ok(
      userMessage.includes(coverLetter),
      "user message should contain the cover letter text"
    );
  });

  it("includes master CV in user message when provided", async () => {
    const chatFn = mockChatFn(VALID_JUDGE_OUTPUT);
    const masterCv = {
      name: "Master Candidate",
      experience: [
        { title: "Senior Engineer", dates: "2020–2023", bullets: ["Led team of 5"] },
        { title: "Junior Dev", dates: "2018–2020", bullets: ["Built APIs"] },
      ],
    };
    await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict", masterCv },
      { chat: chatFn }
    );
    const calls = chatFn.mock.calls as Array<{ arguments: unknown[] }>;
    assert.ok(calls.length > 0);
    const messages = calls[0]?.arguments[0] as Array<{ role: string; content: string }> | undefined;
    assert.ok(messages);
    const userMessage = messages[0]?.content ?? "";
    assert.ok(
      userMessage.includes("## Master CV (ground truth)"),
      "user message should include Master CV section when provided"
    );
    assert.ok(
      userMessage.includes("Master Candidate"),
      "user message should contain master CV content"
    );
  });

  it("does not include master CV section when masterCv is not provided", async () => {
    const chatFn = mockChatFn(VALID_JUDGE_OUTPUT);
    await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    const calls = chatFn.mock.calls as Array<{ arguments: unknown[] }>;
    assert.ok(calls.length > 0);
    const messages = calls[0]?.arguments[0] as Array<{ role: string; content: string }> | undefined;
    assert.ok(messages);
    const userMessage = messages[0]?.content ?? "";
    assert.ok(
      !userMessage.includes("## Master CV (ground truth)"),
      "user message should NOT include Master CV section when not provided"
    );
  });

  it("does not include alignment dimension in strict mode", async () => {
    const chatFn = mockChatFn(VALID_JUDGE_OUTPUT);
    const result = await critiqueCvDraft(
      { curatedCv, jobDescription, curationMode: "strict" },
      { chat: chatFn }
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      // Strict mode critiques should not have alignment issues.
      assert.equal(result.critique.alignmentIssues, undefined);
    }
  });
});

describe("isCritiqueResult", () => {
  it("returns false for null", () => {
    assert.equal(isCritiqueResult(null), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isCritiqueResult(undefined), false);
  });

  it("returns false for empty object", () => {
    assert.equal(isCritiqueResult({}), false);
  });

  it("returns false for array input", () => {
    assert.equal(isCritiqueResult([]), false);
  });
});

describe("buildJudgeUserMessage", () => {
  const curatedCv = {
    name: "Test Candidate",
    experience: [
      { title: "Senior Engineer", dates: "2020–2023", bullets: ["Led team of 5"] },
    ],
  };
  const jobDescription = "We need a senior engineer with React and Node.js experience.";

  it("includes Job Description and Curated CV sections", () => {
    const message = buildJudgeUserMessage({
      curatedCv,
      jobDescription,
      curationMode: "strict",
    });
    assert.ok(message.includes("## Job Description"));
    assert.ok(message.includes("## Curated CV (JSON)"));
    assert.ok(message.includes(jobDescription));
  });

  it("includes Cover Letter section in flexible mode when cover letter provided", () => {
    const coverLetter = "Experienced professional with strong leadership skills.";
    const message = buildJudgeUserMessage({
      curatedCv,
      jobDescription,
      curationMode: "flexible",
      coverLetter,
    });
    assert.ok(message.includes("## Job Description"));
    assert.ok(message.includes("## Curated CV (JSON)"));
    assert.ok(message.includes("## Cover Letter"));
    assert.ok(message.includes(coverLetter));
  });
});
