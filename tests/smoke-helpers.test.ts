import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { ChatResponse } from "../app/api/lib/llm";
import {
  scoreJsonGrounding,
  scoreJsonJdFit,
} from "../app/api/lib/eval-judge";
import {
  evaluateSmokeJudgeGates,
  getSmokeGroundingMin,
  redactCuratedForArtifact,
} from "../app/api/lib/smoke-helpers";

const MASTER = {
  name: "JANE EXAMPLE",
  contact: {
    location: "Example City, ST",
    phone: "+1-555-0100",
    email: "jane@example.com",
    links: [],
  },
  summary: ["Evergreen"],
  experience: [
    {
      title: "Engineer, Example Corp",
      bullets: ["Shipped React feature"],
    },
  ],
};

const CURATED = {
  ...MASTER,
  summary: ["Evergreen"],
};

function mockChat(content: string): ChatResponse {
  return {
    content,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: "test/model",
    finishReason: "stop",
  };
}

describe("scoreJsonGrounding / scoreJsonJdFit", () => {
  it("parses grounding scores from judge JSON", async () => {
    const result = await scoreJsonGrounding(
      MASTER,
      CURATED,
      "React role",
      "test/model",
      {
        chat: async () =>
          mockChat('{"score": 0.9, "flaggedClaims": []}'),
      }
    );
    assert.equal(result.parseFailed, false);
    assert.equal(result.score, 0.9);
  });

  it("marks parseFailed when judge returns garbage", async () => {
    const result = await scoreJsonGrounding(
      MASTER,
      CURATED,
      "React role",
      "test/model",
      { chat: async () => mockChat("not-json") }
    );
    assert.equal(result.parseFailed, true);
  });

  it("parses jd-fit scores", async () => {
    const result = await scoreJsonJdFit(
      MASTER,
      CURATED,
      "React role",
      "test/model",
      {
        chat: async () =>
          mockChat('{"score": 4, "reasoning": "Strong React overlap"}'),
      }
    );
    assert.equal(result.parseFailed, false);
    assert.equal(result.score, 4);
  });

  it("marks parseFailed when jd-fit score is missing (does not clamp to 3)", async () => {
    const result = await scoreJsonJdFit(
      MASTER,
      CURATED,
      "React role",
      "test/model",
      {
        chat: async () =>
          mockChat('{"reasoning": "forgot the score"}'),
      }
    );
    assert.equal(result.parseFailed, true);
    assert.notEqual(result.score, 3);
  });

  it("marks parseFailed when grounding score is missing", async () => {
    const result = await scoreJsonGrounding(
      MASTER,
      CURATED,
      "React role",
      "test/model",
      {
        chat: async () =>
          mockChat('{"flaggedClaims": []}'),
      }
    );
    assert.equal(result.parseFailed, true);
  });
});

describe("getSmokeGroundingMin", () => {
  const original = process.env.SMOKE_GROUNDING_MIN;

  afterEach(() => {
    if (original === undefined) delete process.env.SMOKE_GROUNDING_MIN;
    else process.env.SMOKE_GROUNDING_MIN = original;
  });

  it("keeps fractional SMOKE_GROUNDING_MIN=0.7 as 0.7 not 0", () => {
    process.env.SMOKE_GROUNDING_MIN = "0.7";
    assert.equal(getSmokeGroundingMin(), 0.7);
  });
});

describe("evaluateSmokeJudgeGates", () => {
  it("fails when grounding is below min", () => {
    const gate = evaluateSmokeJudgeGates(
      { score: 0.2, flaggedClaims: [], parseFailed: false },
      { score: 5, reasoning: "ok", parseFailed: false },
      { groundingMin: 0.7, jdFitMin: 3 }
    );
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.match(gate.reasons.join(" "), /grounding/i);
  });

  it("fails on parseFailed regardless of numeric score", () => {
    const gate = evaluateSmokeJudgeGates(
      { score: 1, flaggedClaims: [], parseFailed: true },
      { score: 5, reasoning: "ok", parseFailed: false },
      { groundingMin: 0.7, jdFitMin: 3 }
    );
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.match(gate.reasons.join(" "), /parseFailed/i);
  });

  it("fails when grounding flaggedClaims is non-empty", () => {
    const gate = evaluateSmokeJudgeGates(
      {
        score: 0.95,
        flaggedClaims: ["Invented Acme Corp $10M ARR"],
        parseFailed: false,
      },
      { score: 5, reasoning: "ok", parseFailed: false },
      { groundingMin: 0.7, jdFitMin: 3 }
    );
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.match(gate.reasons.join(" "), /flaggedClaims/i);
  });

  it("passes when both scores meet mins", () => {
    const gate = evaluateSmokeJudgeGates(
      { score: 0.85, flaggedClaims: [], parseFailed: false },
      { score: 4, reasoning: "ok", parseFailed: false },
      { groundingMin: 0.7, jdFitMin: 3 }
    );
    assert.equal(gate.ok, true);
  });
});

describe("redactCuratedForArtifact", () => {
  it("strips contact and free-text bullets", () => {
    const redacted = redactCuratedForArtifact(MASTER) as {
      contact: { redacted?: boolean };
      summary: string[];
      experience: Array<{ bullets: string[] }>;
    };
    assert.equal(redacted.contact.redacted, true);
    assert.deepEqual(redacted.summary, ["[REDACTED]"]);
    assert.deepEqual(redacted.experience[0]!.bullets, ["[REDACTED]"]);
  });
});
