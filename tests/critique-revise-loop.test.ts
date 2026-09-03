import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tailorCvDeps } from "../app/api/lib/tailor-cv-deps";
import { resetRedisClientForTest } from "../app/api/lib/redis";
import {
  authHeaders,
  buildPostRequest,
  ensureEnv,
  injectSlidingWindowMock,
} from "../tests/helpers/tailor-request";
import { buildTailorResponse } from "../app/api/lib/tailor-pipeline";

const FIXTURE_CURATED = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/curated-cv-valid.json"),
    "utf8"
  )
) as Record<string, unknown>;

describe("tailor pipeline — single curator pass", () => {
  beforeEach(() => {
    ensureEnv();
    process.env.CRITIQUE_REVISE_ENABLED = "true";
    resetRedisClientForTest();
    injectSlidingWindowMock();
  });

  afterEach(() => {
    mock.restoreAll();
    resetRedisClientForTest();
    delete process.env.CRITIQUE_REVISE_ENABLED;
  });

  const XFF = authHeaders({ "x-forwarded-for": "198.51.100.42" });
  const VALID_BODY = JSON.stringify({
    jobDescription: "We need a senior engineer with React and Node.js experience.",
    sessionId: "cr-test",
  });

  function mockSingleCuratorPass(content: string = JSON.stringify(FIXTURE_CURATED)) {
    mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
      systemPrompt: "Curate with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
      langfusePrompt: { name: "cv-curator-json", version: 1 },
    }));
    mock.method(tailorCvDeps, "applyCurationModePolicy", (p: string) =>
      p.replace("{{CURATION_MODE_POLICY}}", "MODE: policy")
    );
    mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
      ok: true as const,
      systemPrompt: prompt,
    }));
    mock.method(tailorCvDeps, "buildCuratorUserMessage", (jd: string) => `JD:\n${jd}`);

    let callCount = 0;
    mock.method(tailorCvDeps, "chat", async () => {
      callCount++;
      return {
        content,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "anthropic/sonnet",
        finishReason: "stop",
      };
    });
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);
    return () => callCount;
  }

  it("makes one curator chat call even when CRITIQUE_REVISE_ENABLED is true", async () => {
    const getCallCount = mockSingleCuratorPass();

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, true);
    assert.equal(getCallCount(), 1);
    if (result.ok) {
      const curated = result.body.curatedJson as Record<string, unknown>;
      assert.equal(curated.name, FIXTURE_CURATED.name);
      assert.equal(result.body.usage.totalTokens, 30);
    }
  });

  it("preserves coverLetter from the single flexible curator pass", async () => {
    const coverLetter = "First draft cover letter.";
    const getCallCount = mockSingleCuratorPass(
      JSON.stringify({
        curated_cv: FIXTURE_CURATED,
        cover_letter: coverLetter,
      })
    );

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(
        JSON.stringify({
          jobDescription: "Hospitality GM role.",
          sessionId: "cr-flex",
          curationMode: "flexible",
        }),
        XFF
      )
    );
    assert.equal(result.ok, true);
    assert.equal(getCallCount(), 1);
    if (result.ok) {
      assert.equal(result.body.coverLetter, coverLetter);
    }
  });
});
