import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  callOpenRouter,
  type OpenAICompatibleChatClient,
} from "../app/api/lib/llm";

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
    const mockClient: OpenAICompatibleChatClient = {
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
    };

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
    const mockClient: OpenAICompatibleChatClient = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("OpenRouter rate limit exceeded");
          },
        },
      },
    };

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

  it("throws a clear error when choices is missing (not TypeError on [0])", async () => {
    const mockClient: OpenAICompatibleChatClient = {
      chat: {
        completions: {
          create: async () => ({
            model: "google/gemini-3.1-pro-preview",
            // Malformed / error-shaped OpenRouter body — no choices array
            error: {
              message: "Model unavailable on flex tier",
              code: "model_unavailable",
            },
          }),
        },
      },
    };

    await assert.rejects(
      () =>
        callOpenRouter(
          [{ role: "user", content: "Hi" }],
          "System",
          { model: "google/gemini-3.1-pro-preview" },
          mockClient
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /No response from OpenRouter/i);
        assert.match(err.message, /Model unavailable on flex tier/);
        assert.match(err.message, /model_unavailable/);
        assert.equal(err.name, "Error");
        assert.doesNotMatch(err.message, /Cannot read properties of undefined/i);
        return true;
      }
    );
  });

  it("throws a clear error when message content is empty", async () => {
    const mockClient: OpenAICompatibleChatClient = {
      chat: {
        completions: {
          create: async () => ({
            model: "openai/gpt-4o",
            choices: [
              {
                message: { content: "" },
                finish_reason: "stop",
              },
            ],
          }),
        },
      },
    };

    await assert.rejects(
      () =>
        callOpenRouter(
          [{ role: "user", content: "Hi" }],
          "System",
          { model: "openai/gpt-4o" },
          mockClient
        ),
      /No response from OpenRouter/i
    );
  });

  it("truncates oversized embedded provider errors in thrown messages", async () => {
    const previous = process.env.SAFE_LOG_DETAIL_MAX_CHARS;
    process.env.SAFE_LOG_DETAIL_MAX_CHARS = "60";
    const hugeDetail = "LEAK".repeat(100);
    const mockClient: OpenAICompatibleChatClient = {
      chat: {
        completions: {
          create: async () => ({
            model: "openai/gpt-4o",
            error: { message: hugeDetail, code: "overflow" },
          }),
        },
      },
    };

    try {
      await assert.rejects(
        () =>
          callOpenRouter(
            [{ role: "user", content: "Hi" }],
            "System",
            { model: "openai/gpt-4o" },
            mockClient
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /^No response from OpenRouter — /);
          assert.match(err.message, /…$/);
          // Bound: prefix + " — " + 60 chars + ellipsis
          assert.ok(err.message.length <= "No response from OpenRouter — ".length + 61);
          assert.doesNotMatch(err.message, new RegExp(hugeDetail));
          return true;
        }
      );
    } finally {
      if (previous === undefined) delete process.env.SAFE_LOG_DETAIL_MAX_CHARS;
      else process.env.SAFE_LOG_DETAIL_MAX_CHARS = previous;
    }
  });
});
