import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tailorCvDeps } from "../app/api/lib/tailor-cv-deps";
import { RateLimitError } from "../app/api/lib/errors";
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

function mockFlexiblePipelineSuccess() {
  mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);

  // Flexible mode returns a different prompt
  mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
    systemPrompt: "Flexible pivot prompt with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
    langfusePrompt: {
      name: "cv-curator-flexible-pivot",
      version: 1,
      isFallback: true,
    },
  }));

  mock.method(tailorCvDeps, "applyCurationModePolicy", (prompt: string, mode: string) => {
    if (mode === "flexible") return prompt.replace("{{CURATION_MODE_POLICY}}", "MODE: flexible");
    return prompt.replace("{{CURATION_MODE_POLICY}}", "MODE: strict");
  });

  mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
    ok: true as const,
    systemPrompt: prompt,
  }));
  mock.method(
    tailorCvDeps,
    "buildCuratorUserMessage",
    (jd: string) => `JD:\n${jd}`
  );

  // Flexible mode curator returns wrapper: { curated_cv, cover_letter }
  const wrapper = {
    curated_cv: FIXTURE_CURATED,
    cover_letter: "# Cover Letter\n\nBridging the domain gap...",
  };
  mock.method(tailorCvDeps, "chat", async () => ({
    content: JSON.stringify(wrapper),
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: "anthropic/sonnet",
    finishReason: "stop",
  }));
  mock.method(tailorCvDeps, "isLlmServiceError", () => false);
}

describe("flexible curation — cover letter + wrapper response", () => {
  beforeEach(() => {
    ensureEnv({ critiqueReviseEnabled: false });
    resetRedisClientForTest();
    injectSlidingWindowMock();
  });

  afterEach(() => {
    mock.restoreAll();
    resetRedisClientForTest();
  });

  const XFF = authHeaders({ "x-forwarded-for": "198.51.100.42" });
  const FLEXIBLE_BODY = JSON.stringify({
    jobDescription: "We need a restaurant GM — manage FOH team, control COGS.",
    sessionId: "flex-test",
    curationMode: "flexible",
  });

  it("includes coverLetter in response for flexible mode", async () => {
    mockFlexiblePipelineSuccess();
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(FLEXIBLE_BODY, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.body.curationMode, "flexible");
      assert.equal(typeof result.body.coverLetter, "string");
      assert.ok(result.body.coverLetter!.length > 0);
    }
  });

  it("omits coverLetter for strict mode (backwards compatible)", async () => {
    // strict mode: mock returns bare curated JSON (no wrapper)
    mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
      systemPrompt: "Strict prompt with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
      langfusePrompt: {
        name: "cv-curator-json",
        version: 1,
        isFallback: true,
      },
    }));
    mock.method(tailorCvDeps, "applyCurationModePolicy", (prompt: string) =>
      prompt.replace("{{CURATION_MODE_POLICY}}", "MODE: strict")
    );
    mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
      ok: true as const,
      systemPrompt: prompt,
    }));
    mock.method(tailorCvDeps, "buildCuratorUserMessage", (jd: string) => `JD:\n${jd}`);
    mock.method(tailorCvDeps, "chat", async () => ({
      content: JSON.stringify(FIXTURE_CURATED),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: "anthropic/sonnet",
      finishReason: "stop",
    }));
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);

    const strictBody = JSON.stringify({
      jobDescription: "We need a senior engineer with React experience.",
      sessionId: "strict-test",
    });
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(strictBody, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.body.curationMode, "strict");
      assert.equal(result.body.coverLetter, undefined);
    }
  });

  it("returns 422 when flexible curator output is missing curated_cv", async () => {
    mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
      systemPrompt: "Flex prompt with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
    }));
    mock.method(tailorCvDeps, "applyCurationModePolicy", (p: string) =>
      p.replace("{{CURATION_MODE_POLICY}}", "MODE: flexible")
    );
    mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
      ok: true as const,
      systemPrompt: prompt,
    }));
    mock.method(tailorCvDeps, "buildCuratorUserMessage", (jd: string) => `JD:\n${jd}`);
    // Returns wrapper missing curated_cv
    mock.method(tailorCvDeps, "chat", async () => ({
      content: JSON.stringify({ cover_letter: "no CV here" }),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: "anthropic/sonnet",
      finishReason: "stop",
    }));
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(FLEXIBLE_BODY, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 422);
    }
  });

  it("returns 422 when flexible curator output has curated_cv null", async () => {
    mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
      systemPrompt: "Flex prompt with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
    }));
    mock.method(tailorCvDeps, "applyCurationModePolicy", (p: string) =>
      p.replace("{{CURATION_MODE_POLICY}}", "MODE: flexible")
    );
    mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
      ok: true as const,
      systemPrompt: prompt,
    }));
    mock.method(tailorCvDeps, "buildCuratorUserMessage", (jd: string) => `JD:\n${jd}`);
    mock.method(tailorCvDeps, "chat", async () => ({
      content: JSON.stringify({ curated_cv: null, cover_letter: "cover letter text" }),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: "anthropic/sonnet",
      finishReason: "stop",
    }));
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(FLEXIBLE_BODY, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 422);
    }
  });

  it("returns 422 when flexible curator output wrapper is not valid JSON", async () => {
    mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
      systemPrompt: "Flex prompt with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
    }));
    mock.method(tailorCvDeps, "applyCurationModePolicy", (p: string) =>
      p.replace("{{CURATION_MODE_POLICY}}", "MODE: flexible")
    );
    mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
      ok: true as const,
      systemPrompt: prompt,
    }));
    mock.method(tailorCvDeps, "buildCuratorUserMessage", (jd: string) => `JD:\n${jd}`);
    mock.method(tailorCvDeps, "chat", async () => ({
      content: "not valid json here",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: "anthropic/sonnet",
      finishReason: "stop",
    }));
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(FLEXIBLE_BODY, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 422);
    }
  });

  it("accepts flexible cover letter even when empty string", async () => {
    mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
      systemPrompt: "Flex prompt with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
    }));
    mock.method(tailorCvDeps, "applyCurationModePolicy", (p: string) =>
      p.replace("{{CURATION_MODE_POLICY}}", "MODE: flexible")
    );
    mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
      ok: true as const,
      systemPrompt: prompt,
    }));
    mock.method(tailorCvDeps, "buildCuratorUserMessage", (jd: string) => `JD:\n${jd}`);
    mock.method(tailorCvDeps, "chat", async () => ({
      content: JSON.stringify({ curated_cv: FIXTURE_CURATED, cover_letter: "" }),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: "anthropic/sonnet",
      finishReason: "stop",
    }));
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(FLEXIBLE_BODY, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.body.coverLetter, "");
    }
  });
});
