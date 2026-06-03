import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { callOpenRouter } from "../app/api/lib/llm";

describe("getLLMConfig — maxTokens parsing", () => {
  const originalMaxTokens = process.env.AI_MAX_TOKENS;
  const originalMaxTokensLimit = process.env.AI_MAX_TOKENS_LIMIT;

  afterEach(() => {
    if (originalMaxTokens === undefined) delete process.env.AI_MAX_TOKENS;
    else process.env.AI_MAX_TOKENS = originalMaxTokens;
    if (originalMaxTokensLimit === undefined) delete process.env.AI_MAX_TOKENS_LIMIT;
    else process.env.AI_MAX_TOKENS_LIMIT = originalMaxTokensLimit;
  });

  async function captureMaxTokens(): Promise<number | undefined> {
    let captured: number | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: { max_tokens?: number }) => {
            captured = params.max_tokens;
            return {
              model: "openai/gpt-4o",
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
              choices: [
                {
                  message: { content: "ok" },
                  finish_reason: "stop",
                },
              ],
            };
          },
        },
      },
    } as unknown as OpenAI;

    await callOpenRouter(
      [{ role: "user", content: "Hi" }],
      "System",
      { model: "openai/gpt-4o" },
      mockClient
    );
    return captured;
  }

  it("clamps DEFAULT_MAX_TOKENS fallback to AI_MAX_TOKENS_LIMIT when AI_MAX_TOKENS is unset", async () => {
    delete process.env.AI_MAX_TOKENS;
    process.env.AI_MAX_TOKENS_LIMIT = "4096";
    assert.equal(await captureMaxTokens(), 4096);
  });

  it("clamps DEFAULT_MAX_TOKENS fallback to AI_MAX_TOKENS_LIMIT when AI_MAX_TOKENS is invalid", async () => {
    process.env.AI_MAX_TOKENS = "not-a-number";
    process.env.AI_MAX_TOKENS_LIMIT = "1000";
    assert.equal(await captureMaxTokens(), 1000);
  });

  it("clamps parsed AI_MAX_TOKENS to AI_MAX_TOKENS_LIMIT", async () => {
    process.env.AI_MAX_TOKENS = "99999";
    process.env.AI_MAX_TOKENS_LIMIT = "5000";
    assert.equal(await captureMaxTokens(), 5000);
  });

  it("uses parsed AI_MAX_TOKENS when below limit", async () => {
    process.env.AI_MAX_TOKENS = "2048";
    process.env.AI_MAX_TOKENS_LIMIT = "128000";
    assert.equal(await captureMaxTokens(), 2048);
  });

  it("uses clamped fallback when AI_MAX_TOKENS is zero or negative", async () => {
    process.env.AI_MAX_TOKENS = "0";
    process.env.AI_MAX_TOKENS_LIMIT = "3000";
    assert.equal(await captureMaxTokens(), 3000);

    process.env.AI_MAX_TOKENS = "-100";
    assert.equal(await captureMaxTokens(), 3000);
  });

  it("floors fractional AI_MAX_TOKENS before clamping to limit", async () => {
    process.env.AI_MAX_TOKENS = "2048.9";
    process.env.AI_MAX_TOKENS_LIMIT = "128000";
    assert.equal(await captureMaxTokens(), 2048);
  });
});
