import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateTailorCvBody } from "../app/api/lib/tailor-cv-validation";

describe("validateTailorCvBody", () => {
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
});
