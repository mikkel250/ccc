import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeGoogleEmptyContentResponse } from "../app/api/lib/llm";

describe("describeGoogleEmptyContentResponse", () => {
  it("summarizes structure without candidate text or prompt content (PII-safe)", () => {
    const summary = describeGoogleEmptyContentResponse({
      candidates: [
        {
          index: 0,
          finishReason: "SAFETY",
          content: {
            parts: [{ text: "SECRET PERSON secret@example.com employment history" }],
          },
          safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", blocked: true }],
        },
      ],
      promptFeedback: {
        blockReason: "SAFETY",
        blockReasonMessage: "Prompt contained blocked terms",
        safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", blocked: false }],
      },
      usageMetadata: {
        promptTokenCount: 1200,
        candidatesTokenCount: 0,
        totalTokenCount: 1200,
      },
      modelVersion: "gemini-2.5-pro",
      responseId: "resp-abc123",
    });

    assert.match(summary, /candidateCount=1/);
    assert.match(summary, /finishReasons=\[0:SAFETY\]/);
    assert.match(summary, /blockReason=SAFETY/);
    assert.match(summary, /promptTokens=1200/);
    assert.match(summary, /modelVersion=gemini-2\.5-pro/);
    assert.match(summary, /responseId=resp-abc123/);
    assert.doesNotMatch(summary, /SECRET PERSON|secret@example\.com|employment history/i);
    assert.doesNotMatch(summary, /blocked terms/i);
  });

  it("handles missing optional fields", () => {
    const summary = describeGoogleEmptyContentResponse({});
    assert.match(summary, /candidateCount=0/);
    assert.match(summary, /blockReason=null/);
    assert.match(summary, /usage=null/);
  });
});
