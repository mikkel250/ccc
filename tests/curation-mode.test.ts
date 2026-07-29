import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyCurationModePolicy,
  curationModePolicy,
  groundingJudgeModeAddendum,
  isFlexibleWrapper,
  flexibleCoverLetter,
  CURATION_MODE_POLICY_PLACEHOLDER,
  DEFAULT_CURATION_MODE,
  FLEXIBLE_PIVOT_FALLBACK_PROMPT,
} from "../app/api/lib/curation-mode";
import { getDefaultCurationMode } from "../lib/env";

describe("curation-mode", () => {
  it("FLEXIBLE_PIVOT_FALLBACK_PROMPT encodes master-cv.schema.json hard constraints", () => {
    const prompt = FLEXIBLE_PIVOT_FALLBACK_PROMPT;
    // summary must be string[], not a bare string (OVS thesis lives inside the array)
    assert.match(prompt, /summary:\s*string\[\]/i);
    assert.match(prompt, /not a bare string/i);
    // skills[].items is a comma-separated string in the schema
    assert.match(prompt, /skills\[\]\.items/i);
    assert.match(prompt, /comma-separated string/i);
    // experience oneOf: bullets XOR subroles
    assert.match(prompt, /exactly one of bullets or subroles/i);
    // wrapper shape
    assert.match(prompt, /"curated_cv"/);
    assert.match(prompt, /"cover_letter"/);
    assert.match(prompt, /no markdown fences/i);
  });

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

  it("strict policy forbids collapse; flexible references pivot prompt", () => {
    const strict = curationModePolicy("strict");
    const flexible = curationModePolicy("flexible");
    assert.match(strict, /Do not collapse/i);
    assert.match(flexible, /MODE: flexible/i);
    assert.match(flexible, /competency mapping/i);
    assert.match(flexible, /career-pivot/i);
    assert.match(flexible, /curated_cv/i);
    assert.match(flexible, /cover_letter/i);
    assert.match(flexible, /anti-hallucination/i);
    assert.match(flexible, /collapse a weak-fit cluster/i);
    assert.doesNotMatch(flexible, /Langfuse/i);
    assert.match(flexible, /recency does not override weak/i);
    assert.match(flexible, /industry-agnostic/i);
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

  it("applyCurationModePolicy injects flexible policy via placeholder", () => {
    const out = applyCurationModePolicy(
      `before\n${CURATION_MODE_POLICY_PLACEHOLDER}\nafter`,
      "flexible"
    );
    // Flexible mode now injects the policy like strict mode — not a full replacement.
    assert.match(out, /MODE: flexible/);
    assert.match(out, /competency mapping/i);
    assert.doesNotMatch(out, /Langfuse/i);
    assert.doesNotMatch(out, /CURATION_MODE_POLICY/);
    assert.match(out, /^before\n/);
    assert.match(out, /\nafter$/);
  });

  it("applyCurationModePolicy appends flexible policy when placeholder is missing", () => {
    const out = applyCurationModePolicy("base prompt", "flexible");
    assert.match(out, /base prompt/);
    assert.match(out, /MODE: flexible/);
    assert.match(out, /<curation_mode>/);
  });

  it("applyCurationModePolicy appends when placeholder is missing (strict)", () => {
    const out = applyCurationModePolicy("base prompt only", "strict");
    assert.match(out, /base prompt only/);
    assert.match(out, /<curation_mode>/);
  });

  it("grounding addendum matches mode", () => {
    assert.match(groundingJudgeModeAddendum("strict"), /NOT acceptable/i);
    assert.match(groundingJudgeModeAddendum("flexible"), /Accept collapsing/i);
  });

  describe("isFlexibleWrapper", () => {
    it("returns true for valid wrapper with curated_cv", () => {
      assert.equal(isFlexibleWrapper({ curated_cv: { name: "Test" } }), true);
    });
    it("returns true for wrapper with curated_cv and cover_letter", () => {
      assert.equal(
        isFlexibleWrapper({ curated_cv: {}, cover_letter: "hello" }),
        true
      );
    });
    it("returns false for null", () => {
      assert.equal(isFlexibleWrapper(null), false);
    });
    it("returns false for string", () => {
      assert.equal(isFlexibleWrapper("not an object"), false);
    });
    it("returns false for object missing curated_cv", () => {
      assert.equal(isFlexibleWrapper({ cover_letter: "no cv" }), false);
    });
    it("returns false for array", () => {
      assert.equal(isFlexibleWrapper([]), false);
    });
    it("returns false when cover_letter is present but not a string", () => {
      assert.equal(
        isFlexibleWrapper({ curated_cv: {}, cover_letter: 42 }),
        false
      );
    });
    it("returns true when cover_letter is omitted", () => {
      assert.equal(isFlexibleWrapper({ curated_cv: {} }), true);
    });
    it("returns true when cover_letter is null (treat as omitted)", () => {
      assert.equal(
        isFlexibleWrapper({ curated_cv: {}, cover_letter: null }),
        true
      );
    });
    it("flexibleCoverLetter maps null to undefined", () => {
      assert.equal(
        flexibleCoverLetter({ cover_letter: null }),
        undefined
      );
      assert.equal(
        flexibleCoverLetter({ cover_letter: "hi" }),
        "hi"
      );
    });
  });
});
