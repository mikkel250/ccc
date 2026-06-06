import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getDeepSeekBaseUrl,
  getEnvString,
  getEvalExtractionModel,
  getEvalJudgeModel,
  getEvalModels,
  getTailorModel,
} from "../lib/env";
import {
  CANDIDATE_GENERATION_MODELS,
  DEFAULT_EVAL_EXTRACTION_MODEL,
  DEFAULT_EVAL_JUDGE_MODEL,
  DEFAULT_EVAL_MODELS_CSV,
} from "../app/api/lib/eval-schema";

describe("getEnvString", () => {
  const key = "TEST_ENV_STRING_KEY";

  afterEach(() => {
    delete process.env[key];
  });

  it("returns default when env var is unset", () => {
    delete process.env[key];
    assert.equal(getEnvString(key, "fallback"), "fallback");
  });

  it("returns default when env var is empty string", () => {
    process.env[key] = "";
    assert.equal(getEnvString(key, "fallback"), "fallback");
  });

  it("returns default when env var is whitespace only", () => {
    process.env[key] = "   ";
    assert.equal(getEnvString(key, "fallback"), "fallback");
  });

  it("returns env value when non-empty", () => {
    process.env[key] = "custom-value";
    assert.equal(getEnvString(key, "fallback"), "custom-value");
  });
});

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
    assert.equal(getEvalJudgeModel(), DEFAULT_EVAL_JUDGE_MODEL);
  });

  it("uses default when EVAL_JUDGE_MODEL is empty string", () => {
    process.env.EVAL_JUDGE_MODEL = "";
    assert.equal(getEvalJudgeModel(), DEFAULT_EVAL_JUDGE_MODEL);
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

  it("defaults when EVAL_MODELS is empty string", () => {
    process.env.EVAL_MODELS = "";
    assert.equal(getEvalModels(), DEFAULT_EVAL_MODELS_CSV);
  });
});

describe("getEvalExtractionModel", () => {
  const original = process.env.EVAL_EXTRACTION_MODEL;

  afterEach(() => {
    if (original === undefined) delete process.env.EVAL_EXTRACTION_MODEL;
    else process.env.EVAL_EXTRACTION_MODEL = original;
  });

  it("defaults when EVAL_EXTRACTION_MODEL is empty string", () => {
    process.env.EVAL_EXTRACTION_MODEL = "";
    assert.equal(getEvalExtractionModel(), DEFAULT_EVAL_EXTRACTION_MODEL);
  });
});

describe("getDeepSeekBaseUrl", () => {
  const original = process.env.DEEPSEEK_BASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = original;
  });

  it("defaults when DEEPSEEK_BASE_URL is empty string", () => {
    process.env.DEEPSEEK_BASE_URL = "";
    assert.equal(getDeepSeekBaseUrl(), "https://api.deepseek.com");
  });
});
