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
} from "../app/api/lib/curation-mode";
import { getDefaultCurationMode } from "../lib/env";
import { validateCvJson } from "../app/api/lib/cv-schema";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const validCv = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/curated-cv-valid.json"),
    "utf8"
  )
) as Record<string, unknown>;

describe("curation-mode", () => {
  // Minimal prompt-text check only — schema contract exercised via validateCvJson below.
  it("FLEXIBLE_PIVOT_FALLBACK_PROMPT names curated_cv wrapper and master schema path", () => {
    const prompt = FLEXIBLE_PIVOT_FALLBACK_PROMPT;
    assert.match(prompt, /"curated_cv"/);
    assert.match(prompt, /"cover_letter"/);
    assert.match(prompt, /master-cv\.schema\.json/);
    assert.match(prompt, /additionalProperties:\s*false/i);
  });

  describe("flexible curated_cv contract (schema-enforced)", () => {
    it("accepts a representative valid curated_cv payload", () => {
      assert.equal(validateCvJson(validCv).ok, true);
    });

    it("accepts a flexible wrapper with curated_cv and cover_letter", () => {
      assert.equal(
        isFlexibleWrapper({
          curated_cv: validCv,
          cover_letter: "Dear hiring manager,\n\nI am pivoting…",
        }),
        true
      );
    });

    it("rejects legacy bare-string summary", () => {
      const result = validateCvJson({
        ...validCv,
        summary: "Bare thesis string that should be an array",
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /\/summary must be array/);
      }
    });

    it("rejects legacy skills[].items string array", () => {
      const result = validateCvJson({
        ...validCv,
        skills: [
          {
            category: "Core",
            items: ["TypeScript", "Node"] as unknown as string,
          },
        ],
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /\/skills\/0\/items must be string/);
      }
    });

    it("rejects contact missing required nested fields", () => {
      const result = validateCvJson({
        ...validCv,
        contact: { email: "only@example.com" },
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /\/contact/);
      }
    });

    it("rejects skills[] missing category", () => {
      const result = validateCvJson({
        ...validCv,
        skills: [{ items: "TypeScript, Node" }],
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /\/skills\/0/);
      }
    });

    it("rejects projects[] missing required name/bullets", () => {
      const result = validateCvJson({
        ...validCv,
        projects: [{ linkUrl: "https://example.com" }],
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /\/projects\/0/);
      }
    });

    it("rejects experience with undeclared company property", () => {
      const result = validateCvJson({
        ...validCv,
        experience: [
          {
            title: "Engineer, Example",
            dates: "2024 - Present",
            company: "Example Co",
            bullets: ["Did a thing"],
          },
        ],
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(
          result.error,
          /\/experience\/0 must NOT have additional properties/
        );
      }
    });

    it("allows omitting optional projects entirely", () => {
      const { projects: _dropped, ...withoutProjects } = validCv;
      assert.equal(validateCvJson(withoutProjects).ok, true);
    });
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
