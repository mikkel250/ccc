import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractStructuredJson } from "../app/api/lib/eval-parse";

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
