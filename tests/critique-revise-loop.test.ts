import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { tailorCvDeps } from "../app/api/lib/tailor-cv-deps";
import {
  __injectRatelimitForTest,
  __injectSecretRatelimitForTest,
  getRateLimitConfig,
} from "../app/api/lib/rate-limit";
import { resetRedisClientForTest } from "../app/api/lib/redis";
import {
  createSlidingWindowMock,
} from "../tests/helpers/rate-limit-mock";
import { buildTailorResponse } from "../app/api/lib/tailor-pipeline";

const TEST_API_KEY = "test-tailor-api-key";

const FIXTURE_CURATED = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/curated-cv-valid.json"),
    "utf8"
  )
) as Record<string, unknown>;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${TEST_API_KEY}`,
    ...extra,
  };
}

function buildPostRequest(
  body: string | undefined,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest("http://localhost/api/tailor-cv", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

function injectSlidingWindowMock() {
  const cfg = getRateLimitConfig();
  __injectRatelimitForTest(
    createSlidingWindowMock({
      maxRequests: cfg.maxRequests,
      windowMs: cfg.windowMs,
    })
  );
  __injectSecretRatelimitForTest(
    createSlidingWindowMock({
      maxRequests: cfg.maxRequests * 20,
      windowMs: cfg.windowMs,
    })
  );
}

function ensureEnv() {
  process.env.UPSTASH_REDIS_REST_URL =
    process.env.UPSTASH_REDIS_REST_URL || "https://test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN =
    process.env.UPSTASH_REDIS_REST_TOKEN || "test-token";
  process.env.TAILOR_API_KEY = TEST_API_KEY;
  delete process.env.TAILOR_AUTH_INSECURE_BYPASS;
  process.env.NODE_ENV = "test";
  // Enable critique-revise loop for these tests
  process.env.CRITIQUE_REVISE_ENABLED = "true";
}

describe("critique-revise loop — pipeline wiring", () => {
  let previousCritiqueReviseEnabled: string | undefined;

  beforeEach(() => {
    previousCritiqueReviseEnabled = process.env.CRITIQUE_REVISE_ENABLED;
    ensureEnv();
    resetRedisClientForTest();
    injectSlidingWindowMock();
  });

  afterEach(() => {
    mock.restoreAll();
    resetRedisClientForTest();
    if (previousCritiqueReviseEnabled === undefined) {
      delete process.env.CRITIQUE_REVISE_ENABLED;
    } else {
      process.env.CRITIQUE_REVISE_ENABLED = previousCritiqueReviseEnabled;
    }
  });

  const XFF = authHeaders({ "x-forwarded-for": "198.51.100.42" });
  const VALID_BODY = JSON.stringify({
    jobDescription: "We need a senior engineer with React and Node.js experience.",
    sessionId: "cr-test",
  });

  function mockCritiqueReviseSuccess(curated: Record<string, unknown> = FIXTURE_CURATED) {
    mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
      systemPrompt: "Curate with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
      langfusePrompt: { name: "cv-curator-json", version: 1 },
    }));
    mock.method(tailorCvDeps, "applyCurationModePolicy", (p: string) =>
      p.replace("{{CURATION_MODE_POLICY}}", "MODE: strict")
    );
    mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
      ok: true as const,
      systemPrompt: prompt,
    }));
    mock.method(tailorCvDeps, "buildCuratorUserMessage", (jd: string) => `JD:\n${jd}`);

    // chat is called 3 times: draft, judge, revise
    let callCount = 0;
    mock.method(tailorCvDeps, "chat", async () => {
      callCount++;
      if (callCount === 1) {
        // First draft
        return {
          content: JSON.stringify(curated),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model: "anthropic/sonnet",
          finishReason: "stop",
        };
      }
      if (callCount === 2) {
        // Judge critique
        return {
          content: JSON.stringify({
            narrativeCoherence: { score: 7, feedback: "Good." },
            skepticismPreemption: { score: 7, feedback: "Fine." },
            overqualificationRisk: { score: 7, feedback: "OK." },
            atsViability: { score: 7, feedback: "Decent." },
            redFlags: [],
            hallucinationConcerns: [],
            overallAssessment: "Looks fine.",
          }),
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          model: "anthropic/sonnet",
          finishReason: "stop",
        };
      }
      // Revised draft
      return {
        content: JSON.stringify({ ...curated, name: "Revised CV" }),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "anthropic/sonnet",
        finishReason: "stop",
      };
    });
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);
  }

  it("completes critique-revise loop — judge + revise", async () => {
    mockCritiqueReviseSuccess();

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      // The curated JSON should be the REVISED version (not the first draft)
      const curated = result.body.curatedJson as Record<string, unknown>;
      assert.equal(curated.name, "Revised CV");
      // All completed calls: draft(30) + judge(10) + revise(30)
      assert.equal(result.body.usage.totalTokens, 70);
    }
  });

  it("falls back to first draft when judge call fails", async () => {
    // Use the success mock but override chat to fail on judge call (call 2)
    mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
      systemPrompt: "Curate with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
    }));
    mock.method(tailorCvDeps, "applyCurationModePolicy", (p: string) =>
      p.replace("{{CURATION_MODE_POLICY}}", "MODE: strict")
    );
    mock.method(tailorCvDeps, "compileCuratorPrompt", (p: string) => ({
      ok: true as const, systemPrompt: p,
    }));
    mock.method(tailorCvDeps, "buildCuratorUserMessage", (jd: string) => `JD:\n${jd}`);

    let callCount = 0;
    mock.method(tailorCvDeps, "chat", async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: JSON.stringify(FIXTURE_CURATED),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model: "anthropic/sonnet",
          finishReason: "stop",
        };
      }
      // Judge call (call 2) fails
      throw new Error("Judge service unavailable");
    });
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      // Should get first draft, not revised
      const curated = result.body.curatedJson as Record<string, unknown>;
      assert.equal(curated.name, FIXTURE_CURATED.name);
    }
  });

  it("falls back to first draft when revise call fails", async () => {
    mockCritiqueReviseSuccess();

    let callCount = 0;
    mock.method(tailorCvDeps, "chat", async () => {
      callCount++;
      if (callCount === 3) {
        // Revise call fails
        throw new Error("Revise service unavailable");
      }
      return {
        content:
          callCount === 1
            ? JSON.stringify(FIXTURE_CURATED)
            : JSON.stringify({
                narrativeCoherence: { score: 7, feedback: "Good." },
                skepticismPreemption: { score: 7, feedback: "Fine." },
                overqualificationRisk: { score: 7, feedback: "OK." },
                atsViability: { score: 7, feedback: "Decent." },
                redFlags: [],
                hallucinationConcerns: [],
                overallAssessment: "Looks fine.",
              }),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "anthropic/sonnet",
        finishReason: "stop",
      };
    });
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const curated = result.body.curatedJson as Record<string, unknown>;
      assert.equal(curated.name, FIXTURE_CURATED.name);
    }
    assert.equal(callCount, 3);
  });

  it("includes the first draft content in the revise user message", async () => {
    mockCritiqueReviseSuccess();

    let callCount = 0;
    let reviseMessage: string | undefined;
    mock.method(
      tailorCvDeps,
      "chat",
      async (msgs: Array<{ role: string; content: string }>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify(FIXTURE_CURATED),
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            model: "anthropic/sonnet",
            finishReason: "stop",
          };
        }
        if (callCount === 2) {
          return {
            content: JSON.stringify({
              narrativeCoherence: { score: 7, feedback: "Good." },
              skepticismPreemption: { score: 7, feedback: "Fine." },
              overqualificationRisk: { score: 7, feedback: "OK." },
              atsViability: { score: 7, feedback: "Decent." },
              redFlags: [],
              hallucinationConcerns: [],
              overallAssessment: "Looks fine.",
            }),
            usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
            model: "anthropic/sonnet",
            finishReason: "stop",
          };
        }
        reviseMessage = msgs[0]?.content;
        return {
          content: JSON.stringify({ ...FIXTURE_CURATED, name: "Revised CV" }),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model: "anthropic/sonnet",
          finishReason: "stop",
        };
      }
    );

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, true);
    assert.ok(reviseMessage, "revise call should have been made");
    const firstDraftIdx = reviseMessage.indexOf("## First Draft");
    const critiqueIdx = reviseMessage.indexOf("## Judge Critique");
    assert.ok(firstDraftIdx !== -1, "revise message should include a First Draft section");
    assert.ok(critiqueIdx !== -1, "revise message should include the Judge Critique section");
    assert.ok(
      firstDraftIdx < critiqueIdx,
      "first draft section should precede the judge critique"
    );
    assert.ok(
      reviseMessage.includes(FIXTURE_CURATED.name as string),
      "revise message should include the actual first draft content"
    );
  });

  it("falls back to first draft when revise output is unparseable", async () => {
    mockCritiqueReviseSuccess();

    let callCount = 0;
    mock.method(tailorCvDeps, "chat", async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: JSON.stringify(FIXTURE_CURATED),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model: "anthropic/sonnet",
          finishReason: "stop",
        };
      }
      if (callCount === 2) {
        return {
          content: JSON.stringify({
            narrativeCoherence: { score: 7, feedback: "Good." },
            skepticismPreemption: { score: 7, feedback: "Fine." },
            overqualificationRisk: { score: 7, feedback: "OK." },
            atsViability: { score: 7, feedback: "Decent." },
            redFlags: [],
            hallucinationConcerns: [],
            overallAssessment: "Looks fine.",
          }),
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          model: "anthropic/sonnet",
          finishReason: "stop",
        };
      }
      // Revise call succeeds but returns unparseable content
      return {
        content: "Sorry, I cannot revise this CV.",
        usage: { promptTokens: 7, completionTokens: 8, totalTokens: 15 },
        model: "anthropic/sonnet",
        finishReason: "stop",
      };
    });

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const curated = result.body.curatedJson as Record<string, unknown>;
      assert.equal(curated.name, FIXTURE_CURATED.name);
      // Discarded revise must not leak into usage totals — draft + judge only.
      assert.equal(result.body.usage.totalTokens, 40);
    }
  });

  it("skips critique-revise when CRITIQUE_REVISE_ENABLED is 'off'", async () => {
    process.env.CRITIQUE_REVISE_ENABLED = "off";
    mockCritiqueReviseSuccess();

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const curated = result.body.curatedJson as Record<string, unknown>;
      assert.equal(curated.name, FIXTURE_CURATED.name);
    }
  });

  it("skips critique-revise when CRITIQUE_REVISE_ENABLED is false", async () => {
    process.env.CRITIQUE_REVISE_ENABLED = "false";
    mockCritiqueReviseSuccess();

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const curated = result.body.curatedJson as Record<string, unknown>;
      // Should return first draft (critique-revise was skipped)
      assert.equal(curated.name, FIXTURE_CURATED.name);
    }
  });

  it("preserves coverLetter through critique-revise loop (flexible)", async () => {
    ensureEnv();
    mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
      systemPrompt: "Flex prompt with {{MASTER_CV_JSON}} and {{CURATION_MODE_POLICY}}",
    }));
    mock.method(tailorCvDeps, "applyCurationModePolicy", (p: string) =>
      p.replace("{{CURATION_MODE_POLICY}}", "MODE: flexible")
    );
    mock.method(tailorCvDeps, "compileCuratorPrompt", (p: string) => ({
      ok: true as const, systemPrompt: p,
    }));
    mock.method(tailorCvDeps, "buildCuratorUserMessage", (jd: string) => `JD:\n${jd}`);

    const firstCoverLetter = "First draft cover letter.";
    const revisedCoverLetter = "Revised cover letter.";

    let callCount = 0;
    mock.method(tailorCvDeps, "chat", async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: JSON.stringify({ curated_cv: FIXTURE_CURATED, cover_letter: firstCoverLetter }),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model: "anthropic/sonnet",
          finishReason: "stop",
        };
      }
      if (callCount === 2) {
        // Judge response
        return {
          content: JSON.stringify({
            narrativeCoherence: { score: 6, feedback: "Weak cover letter." },
            skepticismPreemption: { score: 6, feedback: "OK." },
            overqualificationRisk: { score: 7, feedback: "Fine." },
            atsViability: { score: 7, feedback: "Decent." },
            redFlags: [],
            hallucinationConcerns: [],
            alignmentIssues: ["Cover letter too short."],
            overallAssessment: "Revise cover letter.",
          }),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model: "anthropic/sonnet",
          finishReason: "stop",
        };
      }
      // Revise
      return {
        content: JSON.stringify({ curated_cv: FIXTURE_CURATED, cover_letter: revisedCoverLetter }),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "anthropic/sonnet",
        finishReason: "stop",
      };
    });
    mock.method(tailorCvDeps, "isLlmServiceError", () => false);

    const flexibleBody = JSON.stringify({
      jobDescription: "Restaurant GM needed.",
      sessionId: "flex-cr",
      curationMode: "flexible",
    });
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(flexibleBody, XFF)
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.body.coverLetter, revisedCoverLetter);
    }
  });
});
