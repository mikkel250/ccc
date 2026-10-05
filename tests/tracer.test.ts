import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toTraceOptions } from "../app/api/lib/tracers/tracer";
import type { ChatOptions } from "../app/api/lib/llm";

describe("toTraceOptions", () => {
  it("strips every injectable SDK client including googleClient", () => {
    const options = {
      model: "google/gemini-3.1-pro-preview",
      temperature: 0.2,
      googleClient: { sentinel: true },
      openaiClient: { sentinel: true },
      openRouterClient: { sentinel: true },
      deepseekClient: { sentinel: true },
      anthropicClient: { sentinel: true },
    } as unknown as ChatOptions;

    const traceSafe = toTraceOptions(options);

    assert.equal(traceSafe.model, "google/gemini-3.1-pro-preview");
    assert.equal(traceSafe.temperature, 0.2);
    assert.equal(
      Object.prototype.hasOwnProperty.call(traceSafe, "googleClient"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(traceSafe, "openaiClient"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(traceSafe, "openRouterClient"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(traceSafe, "deepseekClient"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(traceSafe, "anthropicClient"),
      false
    );
  });
});
