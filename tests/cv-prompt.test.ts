import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileCvPrompt } from "../app/api/lib/cv-prompt";

describe("compileCvPrompt", () => {
  const CONTEXT = "Mikkel's career background";

  it("substitutes {{CONTEXT}} (Langfuse format)", () => {
    const input = "Use {{CONTEXT}} as the source.";
    const result = compileCvPrompt(input, CONTEXT);
    assert.ok(result.includes(CONTEXT));
    assert.ok(!result.includes("{{CONTEXT}}"));
  });

  it("substitutes {CONTEXT} (fallback format)", () => {
    const input = "Use {CONTEXT} as the source.";
    const result = compileCvPrompt(input, CONTEXT);
    assert.ok(result.includes(CONTEXT));
    assert.ok(!result.includes("{CONTEXT}"));
  });

  it("handles multiple occurrences", () => {
    const input = "Fact 1 from {{CONTEXT}}. Fact 2 from {CONTEXT}.";
    const result = compileCvPrompt(input, CONTEXT);
    assert.ok(!result.includes("{{CONTEXT}}"));
    assert.ok(!result.includes("{CONTEXT}"));
    const occurrences = result.split(CONTEXT).length - 1;
    assert.equal(occurrences, 2);
  });

  it("returns prompt unchanged when no context tag is present", () => {
    const input = "You are a helpful assistant with no special tags.";
    const result = compileCvPrompt(input, CONTEXT);
    assert.equal(result, input);
  });

  it("preserves double braces that are not CONTEXT variables", () => {
    const input = "Use {{example}} for reference and {CONTEXT} for facts.";
    const result = compileCvPrompt(input, CONTEXT);
    assert.ok(result.includes("{{example}}"));
    assert.ok(result.includes(CONTEXT));
    assert.ok(!result.includes("{CONTEXT}"));
  });

  it("handles empty context string", () => {
    const input = "The background is: {{CONTEXT}}.";
    const result = compileCvPrompt(input, "");
    assert.equal(result, "The background is: .");
  });
});
