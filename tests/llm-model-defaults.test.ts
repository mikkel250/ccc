import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  chat,
  callDeepSeek,
  callOpenRouter,
  callAnthropic,
  COST_PER_1K_TOKENS,
} from "../app/api/lib/llm";

const SETTLED_MODELS = [
  "deepseek-v4-pro",
  "gpt-5.4-mini",
  "o4-mini",
  "openai/gpt-5.4-mini",
  "haiku",
  "sonnet",
  "opus",
  "gemini-3.1-pro-preview",
] as const;

const REMOVED_COST_ENTRIES = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gpt-4o",
] as const;

function mockOpenAiChatResponse(model: string) {
  return {
    model,
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
}

describe("provider default models", () => {
  const originalAiModel = process.env.AI_MODEL;

  beforeEach(() => {
    delete process.env.AI_MODEL;
  });

  afterEach(() => {
    if (originalAiModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = originalAiModel;
  });

  it("callDeepSeek defaults to deepseek-v4-pro", async () => {
    let capturedModel: string | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: { model: string }) => {
            capturedModel = params.model;
            return mockOpenAiChatResponse(params.model);
          },
        },
      },
    } as unknown as OpenAI;

    await callDeepSeek(
      [{ role: "user", content: "Hi" }],
      "System",
      { deepseekClient: mockClient }
    );

    assert.equal(capturedModel, "deepseek-v4-pro");
  });

  it("callOpenRouter defaults to openai/gpt-5.4-mini", async () => {
    let capturedModel: string | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: { model: string }) => {
            capturedModel = params.model;
            return mockOpenAiChatResponse(params.model);
          },
        },
      },
    } as unknown as OpenAI;

    await callOpenRouter(
      [{ role: "user", content: "Hi" }],
      "System",
      {},
      mockClient
    );

    assert.equal(capturedModel, "openai/gpt-5.4-mini");
  });

  it("callAnthropic defaults to sonnet", async () => {
    let capturedModel: string | undefined;
    const mockClient = {
      messages: {
        create: async (params: { model: string }) => {
          capturedModel = params.model;
          return {
            model: params.model,
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 1, output_tokens: 1 },
            stop_reason: "end_turn",
          };
        },
      },
    } as unknown as Anthropic;

    await callAnthropic(
      [{ role: "user", content: "Hi" }],
      "System",
      { anthropicClient: mockClient }
    );

    assert.equal(capturedModel, "sonnet");
  });

  it("chat defaults to deepseek-v4-pro", async () => {
    let capturedModel: string | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: { model: string }) => {
            capturedModel = params.model;
            return mockOpenAiChatResponse(params.model);
          },
        },
      },
    } as unknown as OpenAI;

    await chat([{ role: "user", content: "Hi" }], "System", {
      deepseekClient: mockClient,
    });

    assert.equal(capturedModel, "deepseek-v4-pro");
  });
});

describe("COST_PER_1K_TOKENS", () => {
  it("includes entries for all settled models", () => {
    for (const model of SETTLED_MODELS) {
      assert.ok(
        model in COST_PER_1K_TOKENS,
        `expected cost entry for ${model}`
      );
      assert.equal(typeof COST_PER_1K_TOKENS[model], "number");
    }
  });

  it("removes stale cost entries", () => {
    for (const model of REMOVED_COST_ENTRIES) {
      assert.equal(
        COST_PER_1K_TOKENS[model],
        undefined,
        `expected stale entry removed: ${model}`
      );
    }
  });
});
