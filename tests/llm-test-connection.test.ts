import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { testConnection } from "../app/api/lib/llm";

describe("testConnection", () => {
  const originalAiModel = process.env.AI_MODEL;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    delete process.env.AI_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    if (originalAiModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = originalAiModel;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  });

  it("returns false when default openrouter model is used without OPENROUTER_API_KEY", async () => {
    assert.equal(await testConnection(), false);
  });

  it("returns false when deepseek model is configured without DEEPSEEK_API_KEY", async () => {
    process.env.AI_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(await testConnection(), false);
  });

  it("returns true when deepseek model is configured with DEEPSEEK_API_KEY", async () => {
    process.env.AI_MODEL = "deepseek/deepseek-v4-pro";
    process.env.DEEPSEEK_API_KEY = "test-key";
    assert.equal(await testConnection(), true);
  });
});
