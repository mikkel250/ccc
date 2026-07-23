import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getDeepSeekBaseUrl,
  getEnvFloat,
  getEnvNumber,
  getEnvString,
  getEvalExtractionModel,
  getEvalJudgeModel,
  getEvalModels,
  getLLMConfig,
  getTailorModel,
  getDefaultCurationMode,
} from "../lib/env";
import { KNOWN_PROVIDERS as KNOWN_PROVIDERS_FROM_PROVIDERS } from "../lib/providers";
import { KNOWN_PROVIDERS as KNOWN_PROVIDERS_FROM_LLM } from "../app/api/lib/llm";
import {
  CANDIDATE_GENERATION_MODELS,
  DEFAULT_EVAL_EXTRACTION_MODEL,
  DEFAULT_EVAL_JUDGE_MODEL,
  DEFAULT_EVAL_MODELS_CSV,
  getJudgeMap,
  resetJudgeMapCache,
} from "../app/api/lib/eval-schema";

describe("getEnvFloat", () => {
  const key = "TEST_ENV_FLOAT_KEY";

  afterEach(() => {
    delete process.env[key];
  });

  it("preserves fractional values (unlike getEnvNumber/parseInt)", () => {
    process.env[key] = "0.7";
    assert.equal(getEnvFloat(key, 0.5), 0.7);
    assert.equal(getEnvNumber(key, 0.5), 0);
  });

  it("returns default for non-finite input", () => {
    process.env[key] = "not-a-number";
    assert.equal(getEnvFloat(key, 0.7), 0.7);
  });

  it("returns default for partially numeric junk (rejects parseFloat prefix)", () => {
    process.env[key] = "0.7junk";
    assert.equal(getEnvFloat(key, 0.5), 0.5);
  });
});

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

  it("returns valid namespaced TAILOR_MODEL when set", () => {
    process.env.TAILOR_MODEL = "openrouter/google/gemini-2.5-pro";
    assert.equal(getTailorModel(), "openrouter/google/gemini-2.5-pro");
  });

  it('throws when TAILOR_MODEL is unnamespaced "sonnet"', () => {
    process.env.TAILOR_MODEL = "sonnet";
    assert.throws(() => getTailorModel(), /namespaced|provider\/model/i);
  });

  it('throws when TAILOR_MODEL has unknown provider "fake/gpt"', () => {
    process.env.TAILOR_MODEL = "fake/gpt";
    assert.throws(() => getTailorModel(), /unknown provider|fake/i);
  });

  it("passes validation for default when env vars are unset", () => {
    delete process.env.TAILOR_MODEL;
    delete process.env.AI_MODEL;
    assert.doesNotThrow(() => getTailorModel());
  });
});

describe("getDefaultCurationMode", () => {
  const key = "TAILOR_DEFAULT_CURATION_MODE";
  const original = process.env[key];

  afterEach(() => {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  });

  it("defaults to strict when unset", () => {
    delete process.env[key];
    assert.equal(getDefaultCurationMode(), "strict");
  });

  it("accepts flexible when set", () => {
    process.env[key] = "flexible";
    assert.equal(getDefaultCurationMode(), "flexible");
  });

  it("falls back to strict when invalid", () => {
    process.env[key] = "loose";
    assert.equal(getDefaultCurationMode(), "strict");
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

  it("returns valid namespaced EVAL_JUDGE_MODEL when set", () => {
    process.env.EVAL_JUDGE_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(getEvalJudgeModel(), "deepseek/deepseek-v4-pro");
  });

  it('throws when EVAL_JUDGE_MODEL is unnamespaced "claude"', () => {
    process.env.EVAL_JUDGE_MODEL = "claude";
    assert.throws(() => getEvalJudgeModel(), /namespaced|provider\/model/i);
  });

  it('throws when EVAL_JUDGE_MODEL has unknown provider "fake/gpt"', () => {
    process.env.EVAL_JUDGE_MODEL = "fake/gpt";
    assert.throws(() => getEvalJudgeModel(), /unknown provider|fake/i);
  });

  it("passes validation for default when env var is unset", () => {
    delete process.env.EVAL_JUDGE_MODEL;
    assert.doesNotThrow(() => getEvalJudgeModel());
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

  it("returns valid namespaced EVAL_EXTRACTION_MODEL when set", () => {
    process.env.EVAL_EXTRACTION_MODEL = "openrouter/openai/gpt-4o-mini";
    assert.equal(getEvalExtractionModel(), "openrouter/openai/gpt-4o-mini");
  });

  it('throws when EVAL_EXTRACTION_MODEL is unnamespaced "gpt-4o-mini"', () => {
    process.env.EVAL_EXTRACTION_MODEL = "gpt-4o-mini";
    assert.throws(() => getEvalExtractionModel(), /namespaced|provider\/model/i);
  });

  it('throws when EVAL_EXTRACTION_MODEL has unknown provider "fake/gpt"', () => {
    process.env.EVAL_EXTRACTION_MODEL = "fake/gpt";
    assert.throws(() => getEvalExtractionModel(), /unknown provider|fake/i);
  });

  it("passes validation for default when env var is unset", () => {
    delete process.env.EVAL_EXTRACTION_MODEL;
    assert.doesNotThrow(() => getEvalExtractionModel());
  });
});

describe("getJudgeMap — lazy init after env change", () => {
  const originalMapJson = process.env.EVAL_JUDGE_MAP_JSON;

  afterEach(() => {
    if (originalMapJson === undefined) delete process.env.EVAL_JUDGE_MAP_JSON;
    else process.env.EVAL_JUDGE_MAP_JSON = originalMapJson;
    resetJudgeMapCache();
  });

  it("reflects EVAL_JUDGE_MAP_JSON set after module load", () => {
    delete process.env.EVAL_JUDGE_MAP_JSON;
    resetJudgeMapCache();
    const before = getJudgeMap()["anthropic/sonnet"];

    process.env.EVAL_JUDGE_MAP_JSON = JSON.stringify({
      "anthropic/sonnet": "openrouter/openai/gpt-5.4-mini",
    });
    resetJudgeMapCache();
    const after = getJudgeMap()["anthropic/sonnet"];

    assert.notEqual(after, before);
    assert.equal(after, "openrouter/openai/gpt-5.4-mini");
  });
});

describe("provider registry — leaf module (no llm import cycle)", () => {
  it("loads llm module without throwing when getLLMConfig validates defaults", async () => {
    const { LLM_CONFIG } = await import("../app/api/lib/llm");
    assert.equal(typeof LLM_CONFIG.defaultModel, "string");
    assert.match(LLM_CONFIG.defaultModel, /^[^/]+\/.+/);
  });

  it("getLLMConfig returns a validated default model after llm import", async () => {
    await import("../app/api/lib/llm");
    const config = getLLMConfig();
    assert.equal(typeof config.defaultModel, "string");
    assert.match(config.defaultModel, /^[^/]+\/.+/);
  });

  it("llm.ts re-exports the same KNOWN_PROVIDERS instance as the leaf module", () => {
    assert.equal(KNOWN_PROVIDERS_FROM_LLM, KNOWN_PROVIDERS_FROM_PROVIDERS);
  });

  it("rejects a provider not in the known registry", () => {
    const originalTailorModel = process.env.TAILOR_MODEL;
    process.env.TAILOR_MODEL = "fakeprovider/some-model";
    try {
      assert.throws(() => getTailorModel(), /unknown provider "fakeprovider"/i);
    } finally {
      if (originalTailorModel === undefined) delete process.env.TAILOR_MODEL;
      else process.env.TAILOR_MODEL = originalTailorModel;
    }
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
