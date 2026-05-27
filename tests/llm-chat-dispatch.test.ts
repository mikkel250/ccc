import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  chat,
  detectProvider,
  dispatchProvider,
  isLlmServiceError,
} from "../app/api/lib/llm";

describe("detectProvider + dispatchProvider", () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  });

  it("maps gpt-4o to openai provider", () => {
    assert.equal(detectProvider("gpt-4o"), "openai");
  });

  it("maps openai/gpt-4o to openrouter provider", () => {
    assert.equal(detectProvider("openai/gpt-4o"), "openrouter");
  });

  it("maps claude-sonnet-4 to anthropic provider", () => {
    assert.equal(detectProvider("claude-sonnet-4-20250514"), "anthropic");
  });

  it("maps gemini-2.5-pro to google provider", () => {
    assert.equal(detectProvider("gemini-2.5-pro"), "google");
  });

  it("dispatchProvider throws for openai without API key", async () => {
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(
      () =>
        dispatchProvider(
          "openai",
          [{ role: "user", content: "Hi" }],
          "System",
          { model: "gpt-4o" }
        ),
      /OPENAI_API_KEY/
    );
  });

  it("dispatchProvider routes openrouter through callOpenRouter", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({
            model: "openai/gpt-4o",
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
            choices: [
              {
                message: { content: "routed" },
                finish_reason: "stop",
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    process.env.OPENROUTER_API_KEY = "test-key";
    const response = await dispatchProvider(
      "openrouter",
      [{ role: "user", content: "Hi" }],
      "System",
      { model: "openai/gpt-4o", openRouterClient: mockClient }
    );
    assert.equal(response.content, "routed");
  });
});

describe("chat — no fallback retry", () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  it("throws on failure without retrying another provider", async () => {
    let callCount = 0;
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            callCount += 1;
            throw new Error("OpenAI service unavailable");
          },
        },
      },
    } as unknown as OpenAI;

    await assert.rejects(
      () =>
        chat(
          [{ role: "user", content: "Hi" }],
          "System",
          {
            model: "gpt-4o",
            openaiClient: mockClient,
          }
        ),
      /OpenAI service unavailable/
    );
    assert.equal(callCount, 1, "chat must not retry with a second provider");
  });
});

describe("isLlmServiceError", () => {
  it("matches OpenRouter error messages", () => {
    assert.equal(
      isLlmServiceError("OPENROUTER_API_KEY is not configured"),
      true
    );
    assert.equal(isLlmServiceError("OpenRouter rate limit exceeded"), true);
  });

  it("does not match unrelated errors", () => {
    assert.equal(isLlmServiceError("Validation failed"), false);
  });

  it("no longer matches removed All providers failed message", () => {
    assert.equal(isLlmServiceError("All LLM providers failed"), false);
  });
});
