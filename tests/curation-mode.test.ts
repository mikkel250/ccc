import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyCurationModePolicy,
  curationModePolicy,
  groundingJudgeModeAddendum,
  CURATION_MODE_POLICY_PLACEHOLDER,
  DEFAULT_CURATION_MODE,
} from "../app/api/lib/curation-mode";
import { getDefaultCurationMode } from "../lib/env";

describe("curation-mode", () => {
  it("DEFAULT_CURATION_MODE matches getDefaultCurationMode for current env", () => {
    // Import-time snapshot of getDefaultCurationMode(); do not assume "strict".
    assert.equal(DEFAULT_CURATION_MODE, getDefaultCurationMode());
  });

  it("getDefaultCurationMode returns strict when env is unset", () => {
    const key = "TAILOR_DEFAULT_CURATION_MODE";
    const previous = process.env[key];
    delete process.env[key];
    try {
      assert.equal(getDefaultCurationMode(), "strict");
    } finally {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it("getDefaultCurationMode honors an explicit flexible override", () => {
    const key = "TAILOR_DEFAULT_CURATION_MODE";
    const previous = process.env[key];
    process.env[key] = "flexible";
    try {
      assert.equal(getDefaultCurationMode(), "flexible");
    } finally {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it("strict policy forbids collapse; flexible is JD-fit-first and industry-agnostic", () => {
    const strict = curationModePolicy("strict");
    const flexible = curationModePolicy("flexible");
    assert.match(strict, /Do not collapse/i);
    assert.match(flexible, /collapse a weak-fit cluster/i);
    assert.match(flexible, /category-style/i);
    assert.match(flexible, /Lead experience\[\] with the strongest JD-fit/i);
    assert.match(flexible, /Recency does not override weak JD fit/i);
    assert.doesNotMatch(flexible, /restaurant|software engineer|non-tech/i);
  });

  it("applyCurationModePolicy replaces placeholder when present", () => {
    const out = applyCurationModePolicy(
      `before\n${CURATION_MODE_POLICY_PLACEHOLDER}\nafter`,
      "strict"
    );
    assert.match(out, /MODE: strict/);
    assert.doesNotMatch(out, /CURATION_MODE_POLICY/);
    assert.match(out, /^before\n/);
    assert.match(out, /\nafter$/);
  });

  it("applyCurationModePolicy appends when placeholder is missing", () => {
    const out = applyCurationModePolicy("base prompt only", "flexible");
    assert.match(out, /base prompt only/);
    assert.match(out, /<curation_mode>/);
    assert.match(out, /MODE: flexible/);
  });

  it("grounding addendum matches mode", () => {
    assert.match(groundingJudgeModeAddendum("strict"), /NOT acceptable/i);
    assert.match(groundingJudgeModeAddendum("flexible"), /Accept collapsing/i);
  });
});
