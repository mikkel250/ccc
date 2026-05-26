import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectProvider } from "../app/api/lib/llm";

describe("detectProvider", () => {
  it("returns openrouter for provider/model slash pattern", () => {
    assert.equal(detectProvider("openai/gpt-4o"), "openrouter");
    assert.equal(
      detectProvider("anthropic/claude-sonnet-4-20250514"),
      "openrouter"
    );
    assert.equal(detectProvider("google/gemini-2.5-pro"), "openrouter");
  });

  it("returns openai for native OpenAI models", () => {
    assert.equal(detectProvider("gpt-4o"), "openai");
    assert.equal(detectProvider("gpt-4o-mini"), "openai");
  });

  it("returns anthropic for native Claude models", () => {
    assert.equal(detectProvider("claude-sonnet-4-20250514"), "anthropic");
  });

  it("returns google for native Gemini models", () => {
    assert.equal(detectProvider("gemini-2.5-pro"), "google");
  });

  it("returns openai for unknown model strings", () => {
    assert.equal(detectProvider("some-unknown-model"), "openai");
  });
});
