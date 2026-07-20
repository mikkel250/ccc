import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { langsmithTracer } from "../app/api/lib/tracers/langsmith";
import { langfuseTracer } from "../app/api/lib/tracers/langfuse";
import { chat } from "../app/api/lib/llm";

describe("chat() — tracer flush semantics", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    mock.restoreAll();
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  });

  function createSuccessOpenRouterClient() {
    return {
      chat: {
        completions: {
          create: async () => ({
            model: "openai/gpt-4o",
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          }),
        },
      },
    } as unknown as OpenAI;
  }

  function createFailingOpenRouterClient(message = "OpenRouter service unavailable") {
    return {
      chat: {
        completions: {
          create: async () => {
            throw new Error(message);
          },
        },
      },
    } as unknown as OpenAI;
  }

  async function flushMicrotasks(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("success path awaits Langfuse but not LangSmith before returning", async () => {
    let releaseLangfuse!: () => void;
    const langfuseBlocked = new Promise<void>((resolve) => {
      releaseLangfuse = resolve;
    });

    const langsmithSpy = mock.method(langsmithTracer, "record", async () => {
      await new Promise(() => {});
    });
    mock.method(langfuseTracer, "record", async () => {
      await langfuseBlocked;
    });

    const chatPromise = chat(
      [{ role: "user", content: "Hi" }],
      "System",
      {
        model: "openrouter/openai/gpt-4o",
        openRouterClient: createSuccessOpenRouterClient(),
      }
    );

    await flushMicrotasks();

    let settled = false;
    void chatPromise.then(() => {
      settled = true;
    });
    await flushMicrotasks();
    assert.equal(settled, false, "chat() must await recordLangfuseTrace");

    releaseLangfuse();
    await chatPromise;
    assert.equal(langsmithSpy.mock.callCount(), 1);
  });

  it("error path awaits Langfuse but not LangSmith before rethrowing", async () => {
    let releaseLangfuse!: () => void;
    const langfuseBlocked = new Promise<void>((resolve) => {
      releaseLangfuse = resolve;
    });

    const langsmithSpy = mock.method(langsmithTracer, "record", async () => {
      await new Promise(() => {});
    });
    mock.method(langfuseTracer, "record", async () => {
      await langfuseBlocked;
    });

    const chatPromise = chat(
      [{ role: "user", content: "Hi" }],
      "System",
      {
        model: "openrouter/openai/gpt-4o",
        openRouterClient: createFailingOpenRouterClient(),
      }
    );

    await flushMicrotasks();

    let rejected = false;
    void chatPromise.catch(() => {
      rejected = true;
    });
    await flushMicrotasks();
    assert.equal(rejected, false, "chat() must await recordLangfuseTrace on error path");

    releaseLangfuse();
    await assert.rejects(chatPromise, /OpenRouter service unavailable/);
    assert.equal(langsmithSpy.mock.callCount(), 1);
  });
});
