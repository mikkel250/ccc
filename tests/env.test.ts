import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getEvalJudgeModel, getEvalModels, getTailorModel } from "../lib/env";
import {
  CANDIDATE_GENERATION_MODELS,
  DEFAULT_EVAL_MODELS_CSV,
} from "../app/api/lib/eval-schema";

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
    assert.equal(getTailorModel(), "anthropic/sonnet");
  });

  it("uses default when neither env var is set", () => {
    delete process.env.TAILOR_MODEL;
    delete process.env.AI_MODEL;
    assert.equal(getTailorModel(), "anthropic/sonnet");
  });
});

describe("getEvalJudgeModel", () => {
  const originalJudgeModel = process.env.EVAL_JUDGE_MODEL;

  afterEach(() => {
    if (originalJudgeModel === undefined) delete process.env.EVAL_JUDGE_MODEL;
    else process.env.EVAL_JUDGE_MODEL = originalJudgeModel;
  });

  it("prefers EVAL_JUDGE_MODEL when set", () => {
    process.env.EVAL_JUDGE_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(getEvalJudgeModel(), "deepseek/deepseek-v4-pro");
  });

  it("uses default when EVAL_JUDGE_MODEL is unset", () => {
    delete process.env.EVAL_JUDGE_MODEL;
    assert.equal(getEvalJudgeModel(), "anthropic/sonnet");
  });
});

describe("getEvalModels", () => {
  const original = process.env.EVAL_MODELS;

  afterEach(() => {
    if (original === undefined) delete process.env.EVAL_MODELS;
    else process.env.EVAL_MODELS = original;
  });

  it("defaults to DEFAULT_EVAL_MODELS_CSV from eval-schema when unset", () => {
    delete process.env.EVAL_MODELS;
    assert.equal(getEvalModels(), DEFAULT_EVAL_MODELS_CSV);
    assert.deepEqual(
      getEvalModels().split(","),
      [...CANDIDATE_GENERATION_MODELS]
    );
  });
});
