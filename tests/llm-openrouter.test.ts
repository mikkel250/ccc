import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { callOpenRouter } from "../app/api/lib/llm";

describe("callOpenRouter", () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
  });

  it("returns ChatResponse shape on success", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({
            model: "openai/gpt-4o",
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
            choices: [
              {
                message: { content: "Hello from OpenRouter" },
                finish_reason: "stop",
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const response = await callOpenRouter(
      [{ role: "user", content: "Hi" }],
      "System prompt",
      { model: "openai/gpt-4o" },
      mockClient
    );

    assert.equal(response.content, "Hello from OpenRouter");
    assert.equal(response.model, "openai/gpt-4o");
    assert.equal(response.usage.promptTokens, 10);
    assert.equal(response.usage.completionTokens, 5);
    assert.equal(response.usage.totalTokens, 15);
    assert.equal(response.finishReason, "stop");
  });

  it("throws when OPENROUTER_API_KEY is missing and no client override", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(
      () =>
        callOpenRouter(
          [{ role: "user", content: "Hi" }],
          "System",
          { model: "openai/gpt-4o" }
        ),
      /OPENROUTER_API_KEY is not configured/
    );
  });

  it("propagates API errors", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("OpenRouter rate limit exceeded");
          },
        },
      },
    } as unknown as OpenAI;

    await assert.rejects(
      () =>
        callOpenRouter(
          [{ role: "user", content: "Hi" }],
          "System",
          { model: "openai/gpt-4o" },
          mockClient
        ),
      /OpenRouter rate limit exceeded/
    );
  });
});
