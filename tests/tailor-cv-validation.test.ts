import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateTailorCvBody } from "../app/api/lib/tailor-cv-validation";

describe("validateTailorCvBody", () => {
  it("returns clear error when body is not an object", () => {
    for (const invalid of [null, "string", 42, true, []] as const) {
      const result = validateTailorCvBody(invalid, "fallback");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error, "Request body must be an object");
      }
    }
  });

  it("returns 400 error shape for missing jobDescription", () => {
    const result = validateTailorCvBody({}, "fallback");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /required/i);
    }
  });

  it("returns 400 error shape for empty jobDescription", () => {
    const result = validateTailorCvBody({ jobDescription: "   " }, "fallback");
    assert.equal(result.ok, false);
  });

  it("accepts valid jobDescription and uses fallback sessionId", () => {
    const result = validateTailorCvBody(
      { jobDescription: "Senior React engineer role" },
      "ip:1.2.3.4"
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.jobDescription, "Senior React engineer role");
      assert.equal(result.sessionId, "ip:1.2.3.4");
    }
  });

  it("uses provided sessionId when present", () => {
    const result = validateTailorCvBody(
      { jobDescription: "JD text", sessionId: "sess-abc" },
      "ip:1.2.3.4"
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.sessionId, "sess-abc");
    }
  });

  it("returns error for null jobDescription", () => {
    const result = validateTailorCvBody({ jobDescription: null }, "fallback");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /required/i);
  });

  it("returns error for non-string jobDescription (number)", () => {
    const result = validateTailorCvBody({ jobDescription: 42 }, "fallback");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(typeof result.error === "string");
  });

  it("returns error for non-string jobDescription (object)", () => {
    const result = validateTailorCvBody(
      { jobDescription: { text: "jd" } },
      "fallback"
    );
    assert.equal(result.ok, false);
  });

  it("trims leading and trailing whitespace from jobDescription", () => {
    const result = validateTailorCvBody(
      { jobDescription: "  Senior engineer role  " },
      "fallback"
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.jobDescription, "Senior engineer role");
  });

  it("uses fallbackSessionId when sessionId is whitespace-only", () => {
    const result = validateTailorCvBody(
      { jobDescription: "JD text", sessionId: "   " },
      "ip:fallback"
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.sessionId, "ip:fallback");
  });

  it("rejects jobDescription over TAILOR_JD_MAX_CHARS", () => {
    const previous = process.env.TAILOR_JD_MAX_CHARS;
    process.env.TAILOR_JD_MAX_CHARS = "10";
    try {
      const result = validateTailorCvBody(
        { jobDescription: "abcdefghijk" },
        "fallback"
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /size limit/i);
    } finally {
      if (previous === undefined) delete process.env.TAILOR_JD_MAX_CHARS;
      else process.env.TAILOR_JD_MAX_CHARS = previous;
    }
  });

  it("defaults curationMode to strict when omitted", () => {
    const result = validateTailorCvBody(
      { jobDescription: "Senior React engineer role" },
      "ip:1.2.3.4"
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.curationMode, "strict");
    }
  });

  it("accepts curationMode strict and flexible", () => {
    for (const curationMode of ["strict", "flexible"] as const) {
      const result = validateTailorCvBody(
        { jobDescription: "JD text", curationMode },
        "fallback"
      );
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.curationMode, curationMode);
    }
  });

  it("rejects invalid curationMode", () => {
    const result = validateTailorCvBody(
      { jobDescription: "JD text", curationMode: "loose" },
      "fallback"
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /curationMode/i);
  });
});
