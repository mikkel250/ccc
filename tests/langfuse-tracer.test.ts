import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { langfuseTracer } from "../app/api/lib/tracers/langfuse";
import { recordLangfuseTrace } from "../app/api/lib/tracers";
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
