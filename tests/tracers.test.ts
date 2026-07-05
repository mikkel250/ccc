import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { langsmithTracer } from "../app/api/lib/tracers/langsmith";
import { langfuseTracer } from "../app/api/lib/tracers/langfuse";
import { chat } from "../app/api/lib/llm";
import { recordLangSmithTrace, recordLangfuseTrace } from "../app/api/lib/tracers";
import type { ChatResponse } from "../app/api/lib/llm";

const basePayload = {
  provider: "openai" as const,
  model: "gpt-4o",
  messages: [{ role: "user" as const, content: "hi" }],
  systemPrompt: "system",
  response: {
    content: "hello",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: "gpt-4o",
    finishReason: "stop",
  } satisfies ChatResponse,
  startTime: Date.now(),
  options: {},
};

describe("langsmithTracer.isEnabled", () => {
  const original = process.env.LANGSMITH_TRACING;

  afterEach(() => {
    if (original === undefined) delete process.env.LANGSMITH_TRACING;
    else process.env.LANGSMITH_TRACING = original;
  });

  it("is false when LANGSMITH_TRACING is unset", () => {
    delete process.env.LANGSMITH_TRACING;
    assert.equal(langsmithTracer.isEnabled(), false);
  });

  it("is true only when LANGSMITH_TRACING is exactly 'true'", () => {
    process.env.LANGSMITH_TRACING = "true";
    assert.equal(langsmithTracer.isEnabled(), true);
    process.env.LANGSMITH_TRACING = "1";
    assert.equal(langsmithTracer.isEnabled(), false);
  });
});

describe("langfuseTracer.isEnabled", () => {
  const original = process.env.LANGFUSE_TRACING;

  afterEach(() => {
    if (original === undefined) delete process.env.LANGFUSE_TRACING;
    else process.env.LANGFUSE_TRACING = original;
  });

  it("is false when LANGFUSE_TRACING is unset", () => {
    delete process.env.LANGFUSE_TRACING;
    assert.equal(langfuseTracer.isEnabled(), false);
  });

  it("is true only when LANGFUSE_TRACING is exactly 'true'", () => {
    process.env.LANGFUSE_TRACING = "true";
    assert.equal(langfuseTracer.isEnabled(), true);
    process.env.LANGFUSE_TRACING = "yes";
    assert.equal(langfuseTracer.isEnabled(), false);
  });
});

describe("recordLangSmithTrace — fire-and-forget", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("calls the tracer's record() with the exact payload", () => {
    const recordMock = mock.method(langsmithTracer, "record", async () => {});
    recordLangSmithTrace(basePayload);
    assert.equal(recordMock.mock.callCount(), 1);
    assert.deepEqual(recordMock.mock.calls[0]?.arguments[0], basePayload);
  });

  it("returns synchronously without exposing the underlying promise", () => {
    mock.method(langsmithTracer, "record", async () => {});
    const result = recordLangSmithTrace(basePayload);
    assert.equal(result, undefined);
  });

  it("swallows a rejection from record() without throwing", async () => {
    mock.method(langsmithTracer, "record", async () => {
      throw new Error("langsmith boom");
    });
    assert.doesNotThrow(() => recordLangSmithTrace(basePayload));
    // allow the fire-and-forget rejection handler to run
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("recordLangfuseTrace — awaited", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("calls the tracer's record() with the exact payload and awaits it", async () => {
    const recordMock = mock.method(langfuseTracer, "record", async () => {});
    await recordLangfuseTrace(basePayload);
    assert.equal(recordMock.mock.callCount(), 1);
    assert.deepEqual(recordMock.mock.calls[0]?.arguments[0], basePayload);
  });

  it("resolves without throwing when record() rejects", async () => {
    mock.method(langfuseTracer, "record", async () => {
      throw new Error("langfuse boom");
    });
    await assert.doesNotReject(() => recordLangfuseTrace(basePayload));
  });
});

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
