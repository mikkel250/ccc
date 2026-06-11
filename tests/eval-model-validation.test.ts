import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CANDIDATE_GENERATION_MODELS } from "../app/api/lib/eval-schema";
import {
  validateGenerationModel,
  validateGenerationModels,
  toOpenRouterModelId,
} from "../app/api/lib/eval-model-validation";

describe("eval-model-validation", () => {
  it("accepts every default CANDIDATE_GENERATION_MODELS entry", () => {
    assert.doesNotThrow(() => validateGenerationModels(CANDIDATE_GENERATION_MODELS));
  });

  it("maps openrouter-prefixed models to OpenRouter IDs", () => {
    assert.equal(toOpenRouterModelId("openrouter/openai/gpt-5.4"), "openai/gpt-5.4");
    assert.equal(toOpenRouterModelId("deepseek/deepseek-v4-pro"), "deepseek/deepseek-v4-pro");
    assert.equal(toOpenRouterModelId("anthropic/sonnet"), null);
  });

  it("rejects unknown OpenRouter model IDs", () => {
    assert.throws(
      () => validateGenerationModel("openrouter/openai/gpt-99.9-fake"),
      /confirmed catalog/
    );
  });

  it("rejects invalid Anthropic model strings", () => {
    assert.throws(
      () => validateGenerationModel("anthropic/claude-opus-4.8"),
      /Anthropic alias/
    );
  });
});
