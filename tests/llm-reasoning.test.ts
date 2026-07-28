import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  REASONING_EFFORTS,
  getTailorReasoningEffort,
} from "../lib/env";
import {
  buildDeepSeekThinkingParams,
  buildOpenRouterReasoningParams,
  callDeepSeek,
  callOpenRouter,
} from "../app/api/lib/llm";

describe("getTailorReasoningEffort", () => {
  const original = process.env.TAILOR_REASONING_EFFORT;

  afterEach(() => {
    if (original === undefined) delete process.env.TAILOR_REASONING_EFFORT;
    else process.env.TAILOR_REASONING_EFFORT = original;
  });

  it("returns undefined when unset (preserve provider defaults)", () => {
    delete process.env.TAILOR_REASONING_EFFORT;
    assert.equal(getTailorReasoningEffort(), undefined);
  });

  it("returns undefined for blank / whitespace", () => {
    process.env.TAILOR_REASONING_EFFORT = "  ";
    assert.equal(getTailorReasoningEffort(), undefined);
  });

  it("parses supported effort strings case-insensitively", () => {
    for (const effort of REASONING_EFFORTS) {
      process.env.TAILOR_REASONING_EFFORT = effort.toUpperCase();
      assert.equal(getTailorReasoningEffort(), effort);
    }
  });

  it("throws on unsupported effort values", () => {
    process.env.TAILOR_REASONING_EFFORT = "ultra";
    assert.throws(() => getTailorReasoningEffort(), /TAILOR_REASONING_EFFORT/i);
  });
});

describe("buildOpenRouterReasoningParams", () => {
  it("returns undefined when effort is unset", () => {
    assert.equal(buildOpenRouterReasoningParams(undefined), undefined);
  });

  it("wraps effort in reasoning object", () => {
    assert.deepEqual(buildOpenRouterReasoningParams("medium"), {
      reasoning: { effort: "medium" },
    });
  });
});

describe("buildDeepSeekThinkingParams", () => {
  it("returns undefined when effort is unset", () => {
    assert.equal(buildDeepSeekThinkingParams(undefined), undefined);
  });

  it("disables thinking for effort none", () => {
    assert.deepEqual(buildDeepSeekThinkingParams("none"), {
      thinking: { type: "disabled" },
    });
  });

  it("maps medium/high/low/minimal to thinking enabled + high", () => {
    for (const effort of ["minimal", "low", "medium", "high"] as const) {
      assert.deepEqual(buildDeepSeekThinkingParams(effort), {
        thinking: { type: "enabled" },
        reasoning_effort: "high",
      });
    }
  });

  it("maps xhigh/max to thinking enabled + max", () => {
    for (const effort of ["xhigh", "max"] as const) {
      assert.deepEqual(buildDeepSeekThinkingParams(effort), {
        thinking: { type: "enabled" },
        reasoning_effort: "max",
      });
    }
  });
});

describe("callOpenRouter — reasoningEffort", () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalFlex = process.env.OPENROUTER_FLEX_ENABLED;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalFlex === undefined) delete process.env.OPENROUTER_FLEX_ENABLED;
    else process.env.OPENROUTER_FLEX_ENABLED = originalFlex;
  });

  it("omits reasoning when reasoningEffort is unset", async () => {
    process.env.OPENROUTER_FLEX_ENABLED = "false";
    let captured: Record<string, unknown> | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            captured = params;
            return {
              model: "openai/gpt-5.4",
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    } as unknown as OpenAI;

    await callOpenRouter(
      [{ role: "user", content: "Hi" }],
      "System",
      { model: "openai/gpt-5.4", openRouterClient: mockClient }
    );

    assert.equal(captured?.reasoning, undefined);
  });

  it("sends reasoning.effort when reasoningEffort is set", async () => {
    process.env.OPENROUTER_FLEX_ENABLED = "false";
    let captured: Record<string, unknown> | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            captured = params;
            return {
              model: "openai/gpt-5.4",
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    } as unknown as OpenAI;

    await callOpenRouter(
      [{ role: "user", content: "Hi" }],
      "System",
      {
        model: "openai/gpt-5.4",
        reasoningEffort: "medium",
        openRouterClient: mockClient,
      }
    );

    assert.deepEqual(captured?.reasoning, { effort: "medium" });
  });
});

describe("callDeepSeek — reasoningEffort", () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  });

  it("sends thinking + reasoning_effort when reasoningEffort is set", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    let captured: Record<string, unknown> | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            captured = params;
            return {
              model: "deepseek-v4-pro",
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    } as unknown as OpenAI;

    await callDeepSeek(
      [{ role: "user", content: "Hi" }],
      "System",
      {
        model: "deepseek/deepseek-v4-pro",
        reasoningEffort: "medium",
        deepseekClient: mockClient,
      }
    );

    assert.deepEqual(captured?.thinking, { type: "enabled" });
    assert.equal(captured?.reasoning_effort, "high");
  });
});
