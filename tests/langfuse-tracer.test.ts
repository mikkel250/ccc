import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  langfuseTracer,
  buildLangfuseGenerationUpdate,
} from "../app/api/lib/tracers/langfuse";
import { recordLangfuseTrace } from "../app/api/lib/tracers";
import type { ChatResponse } from "../app/api/lib/llm";

const SECRET_SYSTEM = "MASTER_CV_SECRET_PROMPT_TOKEN_xyz";
const SECRET_USER = "CURATED_JSON_SECRET_USER_TOKEN_abc";
const SECRET_RESPONSE = "CURATED_RESPONSE_SECRET_TOKEN_def";

const basePayload = {
  provider: "openai" as const,
  model: "gpt-4o",
  messages: [{ role: "user" as const, content: SECRET_USER }],
  systemPrompt: SECRET_SYSTEM,
  response: {
    content: SECRET_RESPONSE,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: "gpt-4o",
    finishReason: "stop",
  } satisfies ChatResponse,
  startTime: Date.now(),
  options: { source: "tailor-cv-curator", temperature: 0.2, maxTokens: 100 },
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

describe("buildLangfuseGenerationUpdate — content redaction (R8b)", () => {
  it("redacts messages, system prompt, and response content to [REDACTED]", () => {
    const update = buildLangfuseGenerationUpdate(basePayload);
    assert.equal(update.input.messages, "[REDACTED]");
    assert.equal(update.input.system_prompt, "[REDACTED]");
    assert.equal(update.output.content, "[REDACTED]");
  });

  it("keeps usage, model, and source metadata", () => {
    const update = buildLangfuseGenerationUpdate(basePayload);
    assert.deepEqual(update.output.usage, basePayload.response.usage);
    assert.equal(update.model, "gpt-4o");
    assert.equal(update.metadata.source, "tailor-cv-curator");
    assert.deepEqual(update.usageDetails, {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    });
  });

  it("serialized export contains no master/curated fixture substrings", () => {
    const serialized = JSON.stringify(buildLangfuseGenerationUpdate(basePayload));
    assert.equal(serialized.includes(SECRET_SYSTEM), false);
    assert.equal(serialized.includes(SECRET_USER), false);
    assert.equal(serialized.includes(SECRET_RESPONSE), false);
  });
});
