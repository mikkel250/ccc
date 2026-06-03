import { describe, it } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { callDeepSeek } from "../app/api/lib/llm";

describe("callDeepSeek", () => {
  it("returns ChatResponse shape on success", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({
            model: "deepseek-v4-pro",
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
            choices: [
              {
                message: { content: "Hello from DeepSeek" },
                finish_reason: "stop",
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const response = await callDeepSeek(
      [{ role: "user", content: "Hi" }],
      "System prompt",
      { model: "deepseek-v4-pro", deepseekClient: mockClient }
    );

    assert.equal(response.content, "Hello from DeepSeek");
    assert.equal(response.model, "deepseek-v4-pro");
    assert.equal(response.usage.promptTokens, 10);
    assert.equal(response.usage.completionTokens, 5);
    assert.equal(response.usage.totalTokens, 15);
    assert.equal(response.finishReason, "stop");
  });

  it("throws when model is missing", async () => {
    await assert.rejects(
      () => callDeepSeek([{ role: "user", content: "Hi" }], "System", {}),
      /model is required for callDeepSeek/
    );
  });

  it("propagates API errors", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("DeepSeek rate limit exceeded");
          },
        },
      },
    } as unknown as OpenAI;

    await assert.rejects(
      () =>
        callDeepSeek(
          [{ role: "user", content: "Hi" }],
          "System",
          { model: "deepseek-v4-pro", deepseekClient: mockClient }
        ),
      /DeepSeek rate limit exceeded/
    );
  });
});
