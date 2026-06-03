import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectProvider } from "../app/api/lib/llm";

describe("detectProvider", () => {
  it("returns openrouter for OpenAI and Google slash patterns", () => {
    assert.equal(detectProvider("openai/gpt-4o"), "openrouter");
    assert.equal(detectProvider("google/gemini-2.5-pro"), "openrouter");
  });

  it("routes bare gpt-5.4-mini to openrouter", () => {
    assert.equal(detectProvider("gpt-5.4-mini"), "openrouter");
  });

  it("routes bare o4-mini to openrouter", () => {
    assert.equal(detectProvider("o4-mini"), "openrouter");
  });

  it("routes bare gemini-3.1-pro-preview to openrouter", () => {
    assert.equal(detectProvider("gemini-3.1-pro-preview"), "openrouter");
  });

  it("routes bare deepseek-v4-pro to deepseek provider", () => {
    assert.equal(detectProvider("deepseek-v4-pro") as string, "deepseek");
  });

  it("routes slash-prefixed deepseek to openrouter (credit-fallback)", () => {
    assert.equal(detectProvider("deepseek/deepseek-v4-pro"), "openrouter");
  });

  it("routes evergreen Anthropic tier aliases to anthropic provider", () => {
    assert.equal(detectProvider("sonnet"), "anthropic");
    assert.equal(detectProvider("opus"), "anthropic");
    assert.equal(detectProvider("haiku"), "anthropic");
  });

  it("routes slash-prefixed anthropic/claude-sonnet-4 to anthropic (no OpenRouter)", () => {
    assert.equal(detectProvider("anthropic/claude-sonnet-4"), "anthropic");
  });

  it("routes bare claude-* generation IDs to anthropic provider", () => {
    assert.equal(detectProvider("claude-sonnet-4-6"), "anthropic");
  });

  it("routes bare unknown some-model to openrouter (new default)", () => {
    assert.equal(detectProvider("some-model"), "openrouter");
  });
});
