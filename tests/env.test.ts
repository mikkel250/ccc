import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getTailorModel } from "../lib/env";

describe("getTailorModel", () => {
  const originalTailorModel = process.env.TAILOR_MODEL;
  const originalAiModel = process.env.AI_MODEL;

  afterEach(() => {
    if (originalTailorModel === undefined) delete process.env.TAILOR_MODEL;
    else process.env.TAILOR_MODEL = originalTailorModel;
    if (originalAiModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = originalAiModel;
  });

  it("prefers TAILOR_MODEL when set", () => {
    process.env.TAILOR_MODEL = "openrouter/google/gemini-2.5-pro";
    process.env.AI_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(getTailorModel(), "openrouter/google/gemini-2.5-pro");
  });

  it("uses DEFAULT_TAILOR_MODEL when TAILOR_MODEL is unset, ignoring AI_MODEL", () => {
    delete process.env.TAILOR_MODEL;
    process.env.AI_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(getTailorModel(), "openrouter/google/gemini-2.5-pro");
  });

  it("uses default when neither env var is set", () => {
    delete process.env.TAILOR_MODEL;
    delete process.env.AI_MODEL;
    assert.equal(getTailorModel(), "openrouter/google/gemini-2.5-pro");
  });
});
