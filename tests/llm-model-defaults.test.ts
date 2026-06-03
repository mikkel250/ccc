import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  chat,
  callDeepSeek,
  callOpenRouter,
  callAnthropic,
} from "../app/api/lib/llm";

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

  it("callDeepSeek uses the model from options", async () => {
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
      { deepseekClient: mockClient, model: "deepseek-v4-pro" }
    );

    assert.equal(capturedModel, "deepseek-v4-pro");
  });

  it("callOpenRouter uses the model from options", async () => {
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
      { model: "openai/gpt-5.4-mini" },
      mockClient
    );

    assert.equal(capturedModel, "openai/gpt-5.4-mini");
  });

  it("callAnthropic falls back to anthropic-models.json when models.list fails", async () => {
    let capturedModel: string | undefined;
    const mockClient = {
      models: {
        list: async () => {
          throw new Error("Anthropic API unavailable");
        },
      },
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
      { anthropicClient: mockClient, model: "haiku" }
    );

    assert.equal(capturedModel, "claude-haiku-4-5");
  });

  it("callAnthropic resolves sonnet alias to versioned model id", async () => {
    let capturedModel: string | undefined;
    const mockClient = {
      models: {
        list: async () => ({
          data: [{ id: "claude-sonnet-4-6" }],
        }),
      },
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
      { anthropicClient: mockClient, model: "sonnet" }
    );

    assert.equal(capturedModel, "claude-sonnet-4-6");
  });

  it("callAnthropic passes through pinned versioned model IDs", async () => {
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
      { anthropicClient: mockClient, model: "claude-sonnet-4-6" }
    );

    assert.equal(capturedModel, "claude-sonnet-4-6");
  });

  it("callAnthropic resolves opus alias and strips anthropic/ prefix", async () => {
    let capturedModel: string | undefined;
    const mockClient = {
      models: {
        list: async () => ({
          data: [{ id: "claude-opus-4-8" }],
        }),
      },
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
      { anthropicClient: mockClient, model: "anthropic/claude-sonnet-4-6" }
    );

    // anthropic/ prefix stripped, versioned ID passes through
    assert.equal(capturedModel, "claude-sonnet-4-6");
  });

  it("callAnthropic passes through dotted-version model ids with and without anthropic/ prefix", async () => {
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

    // Without prefix
    await callAnthropic(
      [{ role: "user", content: "Hi" }],
      "System",
      { anthropicClient: mockClient, model: "claude-sonnet-4.6-20260218" }
    );
    assert.equal(capturedModel, "claude-sonnet-4.6-20260218");

    // With anthropic/ prefix
    await callAnthropic(
      [{ role: "user", content: "Hi" }],
      "System",
      { anthropicClient: mockClient, model: "anthropic/claude-sonnet-4.6-20260218" }
    );
    assert.equal(capturedModel, "claude-sonnet-4.6-20260218");
  });

  it("chat defaults to openrouter/openai/gpt-5.4-mini (strips to openai/gpt-5.4-mini for OpenRouter API)", async () => {
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
      openRouterClient: mockClient,
    });

    assert.equal(capturedModel, "openai/gpt-5.4-mini");
  });
});
