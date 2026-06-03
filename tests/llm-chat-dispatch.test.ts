import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  chat,
  callOpenRouter,
  detectProvider,
  dispatchProvider,
  isLlmServiceError,
} from "../app/api/lib/llm";

function mockOpenAiChatResponse(content: string, model: string) {
  return {
    model,
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
    choices: [
      {
        message: { content },
        finish_reason: "stop",
      },
    ],
  };
}

function createCapturingOpenRouterClient(
  onCreate?: (params: Record<string, unknown>) => void
) {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          onCreate?.(params);
          return mockOpenAiChatResponse(
            "routed",
            String(params.model ?? "openai/gpt-4o")
          );
        },
      },
    },
  } as unknown as OpenAI;
}

describe("detectProvider + dispatchProvider", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;

  afterEach(() => {
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  });

  it('maps deepseek/deepseek-v4-pro to "deepseek" provider', () => {
    assert.equal(detectProvider("deepseek/deepseek-v4-pro"), "deepseek");
  });

  it("maps openrouter/openai/gpt-4o to openrouter provider", () => {
    assert.equal(detectProvider("openrouter/openai/gpt-4o"), "openrouter");
  });

  it("maps anthropic/sonnet to anthropic provider", () => {
    assert.equal(detectProvider("anthropic/sonnet"), "anthropic");
  });

  it("maps openai/gpt-4o to openai provider", () => {
    assert.equal(detectProvider("openai/gpt-4o"), "openai");
  });

  it("dispatchProvider routes openrouter through callOpenRouter and strips prefix", async () => {
    let capturedModel: string | undefined;
    const mockClient = createCapturingOpenRouterClient((params) => {
      capturedModel = String(params.model);
    });

    process.env.OPENROUTER_API_KEY = "test-key";
    const response = await dispatchProvider(
      "openrouter",
      [{ role: "user", content: "Hi" }],
      "System",
      { model: "openrouter/openai/gpt-4o", openRouterClient: mockClient }
    );
    assert.equal(response.content, "routed");
    assert.equal(capturedModel, "openai/gpt-4o");
  });

  it("dispatchProvider routes deepseek through callDeepSeek and strips prefix", async () => {
    let capturedModel: string | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: { model: string }) => {
            capturedModel = params.model;
            return mockOpenAiChatResponse("deepseek response", params.model);
          },
        },
      },
    } as unknown as OpenAI;

    const response = await dispatchProvider(
      "deepseek",
      [{ role: "user", content: "Hi" }],
      "System",
      { model: "deepseek/deepseek-v4-pro", deepseekClient: mockClient }
    );

    assert.equal(response.content, "deepseek response");
    assert.equal(capturedModel, "deepseek-v4-pro");
  });
});

describe("callOpenRouter — openRouterFlex", () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("sets service_tier flex by default", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const mockClient = createCapturingOpenRouterClient((params) => {
      capturedParams = params;
    });

    await callOpenRouter(
      [{ role: "user", content: "Hi" }],
      "System",
      { model: "openai/gpt-5.4-mini", openRouterClient: mockClient }
    );

    assert.equal(capturedParams?.service_tier, "flex");
  });

  it("omits flex tier when openRouterFlex is false", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const mockClient = createCapturingOpenRouterClient((params) => {
      capturedParams = params;
    });

    await callOpenRouter(
      [{ role: "user", content: "Hi" }],
      "System",
      {
        model: "openai/gpt-5.4-mini",
        openRouterFlex: false,
        openRouterClient: mockClient,
      }
    );

    assert.equal(capturedParams?.service_tier, undefined);
  });
});

describe("chat — no fallback retry", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  });

  it("throws on failure without retrying another provider", async () => {
    let callCount = 0;
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            callCount += 1;
            throw new Error("OpenRouter service unavailable");
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
            model: "openrouter/openai/gpt-4o",
            openRouterClient: mockClient,
          }
        ),
      /OpenRouter service unavailable/
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

  it("matches DeepSeek error messages", () => {
    assert.equal(
      isLlmServiceError("DEEPSEEK_API_KEY is not configured"),
      true
    );
    assert.equal(isLlmServiceError("DeepSeek rate limit exceeded"), true);
  });

  it("does not match unrelated errors", () => {
    assert.equal(isLlmServiceError("Validation failed"), false);
  });

  it("no longer matches removed All providers failed message", () => {
    assert.equal(isLlmServiceError("All LLM providers failed"), false);
  });
});
