import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ChatResponse } from "../app/api/lib/llm";
import type { JdExtraction } from "../app/api/lib/eval-schema";
import { extractJdMetadata } from "../app/api/lib/eval-extract";

const SAMPLE_JD =
  "Acme Corp is hiring a Senior Full-Stack Engineer. Must have 6+ years TypeScript, React, and Node.js. Nice to have GraphQL and AWS experience.";

const SHORT_JD = "Junior React developer needed. 2 years experience.";

const FULL_EXTRACTION_PAYLOAD = {
  requirements: [
    {
      statement: "6+ years TypeScript, React, and Node.js",
      weight: "Must-Have",
      keywords: ["TypeScript", "React", "Node.js"],
    },
    {
      statement: "GraphQL and AWS experience",
      weight: "Nice-to-Have",
      keywords: ["GraphQL", "AWS"],
    },
  ],
  hiringContext: "Default",
  roleType: "Full-stack",
  topTechnologies: ["TypeScript", "React", "Node.js"],
  primaryResponsibilities: ["Build full-stack features"],
  title: "Senior Full-Stack Engineer",
  seniority: "IC",
  domainKnowledge: ["web applications"],
  keyVerbs: ["build", "ship"],
  implicitSuccessSignals: ["Owns end-to-end delivery"],
  keywordBank: {
    mustHaves: ["TypeScript", "React"],
    tools: ["Node.js"],
    certifications: [],
    verbs: ["build"],
  },
  rawJd: SAMPLE_JD,
};

function mockChatResponse(content: string, model = "openrouter/openai/gpt-4o-mini"): ChatResponse {
  return {
    content,
    usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
    model,
    finishReason: "stop",
  };
}

function assertJdExtractionShape(extraction: JdExtraction): void {
  assert.equal(typeof extraction.parseFailed, "boolean");
  assert.ok(Array.isArray(extraction.requirements));
  assert.equal(typeof extraction.hiringContext, "string");
  assert.equal(typeof extraction.roleType, "string");
  assert.ok(Array.isArray(extraction.topTechnologies));
  assert.ok(Array.isArray(extraction.primaryResponsibilities));
  assert.equal(typeof extraction.title, "string");
  assert.equal(typeof extraction.seniority, "string");
  assert.ok(Array.isArray(extraction.domainKnowledge));
  assert.ok(Array.isArray(extraction.keyVerbs));
  assert.ok(Array.isArray(extraction.implicitSuccessSignals));
  assert.equal(typeof extraction.keywordBank, "object");
  assert.equal(typeof extraction.rawJd, "string");
}

describe("extractJdMetadata — mock chat()", () => {
  it("parses valid extraction JSON into JdExtraction with all required fields", async () => {
    const result = await extractJdMetadata(SAMPLE_JD, {
      chat: async () => mockChatResponse(JSON.stringify(FULL_EXTRACTION_PAYLOAD)),
    });
    assertJdExtractionShape(result);
    assert.equal(result.requirements.length, 2);
    assert.equal(result.requirements[0]!.weight, "Must-Have");
    assert.equal(result.title, "Senior Full-Stack Engineer");
    assert.ok(result.keywordBank.mustHaves!.includes("TypeScript"));
    assert.equal(result.parseFailed, false);
  });

  it("returns parseFailed true with emptyExtraction fields on malformed JSON", async () => {
    const result = await extractJdMetadata(SAMPLE_JD, {
      chat: async () => mockChatResponse("not valid json {{{"),
    });
    assertJdExtractionShape(result);
    assert.equal(result.parseFailed, true);
    assert.equal(result.requirements.length, 0);
    assert.equal(result.rawJd, SAMPLE_JD);
    assert.equal(result.title, "Unknown");
  });

  it("handles empty JD input without throwing", async () => {
    const result = await extractJdMetadata("", {
      chat: async () => mockChatResponse(JSON.stringify({ ...FULL_EXTRACTION_PAYLOAD, requirements: [] })),
    });
    assertJdExtractionShape(result);
    assert.equal(result.rawJd, "");
  });

  it("handles very short JD (<100 words) and still extracts available fields", async () => {
    const result = await extractJdMetadata(SHORT_JD, {
      chat: async () =>
        mockChatResponse(
          JSON.stringify({
            ...FULL_EXTRACTION_PAYLOAD,
            title: "Junior React Developer",
            requirements: [
              {
                statement: "2 years React experience",
                weight: "Must-Have",
                keywords: ["React"],
              },
            ],
            rawJd: SHORT_JD,
          })
        ),
    });
    assertJdExtractionShape(result);
    assert.equal(result.title, "Junior React Developer");
    assert.ok(result.requirements.length >= 1);
  });

  it("parses JSON wrapped in markdown code fences", async () => {
    const result = await extractJdMetadata(SAMPLE_JD, {
      chat: async () =>
        mockChatResponse(
          `Here is the extraction:\n\`\`\`json\n${JSON.stringify(FULL_EXTRACTION_PAYLOAD)}\n\`\`\``
        ),
    });
    assertJdExtractionShape(result);
    assert.equal(result.roleType, "Full-stack");
  });

  it("parses plain JSON with trailing explanatory text", async () => {
    const result = await extractJdMetadata(SAMPLE_JD, {
      chat: async () =>
        mockChatResponse(`${JSON.stringify(FULL_EXTRACTION_PAYLOAD)}\n\nNote: extracted from posting.`),
    });
    assertJdExtractionShape(result);
    assert.equal(result.topTechnologies.length, 3);
  });
});

describe("extractJdMetadata — RUN_LLM_TESTS integration", () => {
  const runLive = process.env.RUN_LLM_TESTS === "true";

  it("live extraction returns JdExtraction with requirements and keywordBank", { skip: !runLive }, async () => {
    const result = await extractJdMetadata(SAMPLE_JD);
    assertJdExtractionShape(result);
    assert.ok(result.requirements.length >= 1);
    assert.ok(result.rawJd.length > 0);
  });
});
