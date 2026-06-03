import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectProvider } from "../app/api/lib/llm";

describe("detectProvider — config-lookup (provider/model namespace)", () => {
  it("returns openrouter for openrouter-prefixed models", () => {
    assert.equal(detectProvider("openrouter/openai/gpt-4o"), "openrouter");
    assert.equal(detectProvider("openrouter/google/gemini-2.5-pro"), "openrouter");
    assert.equal(detectProvider("openrouter/openai/gpt-5.4-mini"), "openrouter");
  });

  it("returns anthropic for anthropic-prefixed models", () => {
    assert.equal(detectProvider("anthropic/sonnet"), "anthropic");
    assert.equal(detectProvider("anthropic/claude-sonnet-4-6"), "anthropic");
    assert.equal(detectProvider("anthropic/opus"), "anthropic");
    assert.equal(detectProvider("anthropic/haiku"), "anthropic");
  });

  it("returns openai for openai-prefixed models", () => {
    assert.equal(detectProvider("openai/gpt-4o"), "openai");
    assert.equal(detectProvider("openai/gpt-4o-mini"), "openai");
  });

  it("returns deepseek for deepseek-prefixed models", () => {
    assert.equal(detectProvider("deepseek/deepseek-v4-pro"), "deepseek");
  });

  it("returns google for google-prefixed models", () => {
    assert.equal(detectProvider("google/gemini-2.5-pro"), "google");
  });

  it("throws for bare model strings without a provider prefix", () => {
    assert.throws(() => detectProvider("gpt-4o"), /Invalid model string/);
    assert.throws(() => detectProvider("sonnet"), /Invalid model string/);
    assert.throws(() => detectProvider("deepseek-v4-pro"), /Invalid model string/);
    assert.throws(() => detectProvider("gemini-2.5-pro"), /Invalid model string/);
  });

  it("throws for unknown provider prefix", () => {
    assert.throws(() => detectProvider("cohere/command-r"), /Unknown provider/);
    assert.throws(() => detectProvider("mistral/mixtral-8x7b"), /Unknown provider/);
  });
});
