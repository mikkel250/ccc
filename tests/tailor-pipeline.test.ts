import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { tailorCvDeps } from "../app/api/lib/tailor-cv-deps";
import { RateLimitError, ServiceError } from "../app/api/lib/errors";
import {
  __injectRatelimitForTest,
  __injectSecretRatelimitForTest,
  getRateLimitConfig,
} from "../app/api/lib/rate-limit";
import { resetRedisClientForTest } from "../app/api/lib/redis";
import {
  createSlidingWindowMock,
  createFailingMock,
} from "../tests/helpers/rate-limit-mock";
import { BUILDER_VERSION } from "../app/api/lib/json-docx-builder";
import { getTailorJdMaxChars } from "../app/api/lib/cv-schema";
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

const VALID_BODY = JSON.stringify({
  jobDescription: "We need a senior engineer with React and Node.js experience.",
  sessionId: "test-session",
});

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

function mockPipelineSuccess(
  curated: Record<string, unknown> = FIXTURE_CURATED
) {
  mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
  mock.method(tailorCvDeps, "getCuratorPrompt", async (_mode?: string) => ({
    systemPrompt: "Curate with {{MASTER_CV_JSON}}",
    langfusePrompt: {
      name: "cv-curator-json",
      version: 1,
      isFallback: true,
    },
  }));
  mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
    ok: true as const,
    systemPrompt: prompt,
  }));
  mock.method(
    tailorCvDeps,
    "buildCuratorUserMessage",
    (jd: string) => `JD:\n${jd}`
  );
  mock.method(tailorCvDeps, "chat", async () => ({
    content: JSON.stringify(curated),
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: "anthropic/sonnet",
    finishReason: "stop",
  }));
  mock.method(tailorCvDeps, "isLlmServiceError", () => false);
}

function ensureEnv() {
  process.env.UPSTASH_REDIS_REST_URL =
    process.env.UPSTASH_REDIS_REST_URL || "https://test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN =
    process.env.UPSTASH_REDIS_REST_TOKEN || "test-token";
  process.env.TAILOR_API_KEY = TEST_API_KEY;
  delete process.env.TAILOR_AUTH_INSECURE_BYPASS;
  process.env.NODE_ENV = "test";
  process.env.CRITIQUE_REVISE_ENABLED = "false";
}

describe("buildTailorResponse — pipeline orchestration", () => {
  beforeEach(() => {
    ensureEnv();
    resetRedisClientForTest();
    injectSlidingWindowMock();
  });

  afterEach(() => {
    mock.restoreAll();
    resetRedisClientForTest();
  });

  const XFF = authHeaders({ "x-forwarded-for": "198.51.100.42" });

  // --- Auth gate ---

  it("returns auth error when Authorization is missing", async () => {
    const chatSpy = mock.method(tailorCvDeps, "chat");
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, { "x-forwarded-for": "198.51.100.42" })
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 401);
    }
    assert.equal(chatSpy.mock.callCount(), 0);
  });

  it("returns auth error for wrong Bearer token", async () => {
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, {
        "x-forwarded-for": "198.51.100.42",
        authorization: "Bearer wrong-key",
      })
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  });

  // --- IP resolution ---

  it("returns error when x-forwarded-for is missing", async () => {
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, authHeaders())
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("returns error when x-forwarded-for contains no valid IP", async () => {
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(
        VALID_BODY,
        authHeaders({ "x-forwarded-for": "not-an-ip" })
      )
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("does not call rate-limit when IP cannot be determined", async () => {
    const checkRateLimitSpy = mock.method(tailorCvDeps, "checkRateLimit");
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, authHeaders())
    );
    assert.equal(result.ok, false);
    assert.equal(checkRateLimitSpy.mock.callCount(), 0);
  });

  // --- Rate limiting ---

  it("returns rate limit error when RateLimitError is thrown", async () => {
    mock.method(tailorCvDeps, "checkRateLimit", async () => {
      throw new RateLimitError(
        "Too many requests. Please wait before trying again."
      );
    });

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 429);
  });

  it("returns service error when rate limit throws ServiceError", async () => {
    __injectRatelimitForTest(createFailingMock());

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  });

  // --- Body size / JSON parse ---

  it("returns error for empty body", async () => {
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest("", XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("returns error for oversize Content-Length without calling master or LLM", async () => {
    const masterSpy = mock.method(tailorCvDeps, "requireMasterCv");
    const chatSpy = mock.method(tailorCvDeps, "chat");
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, {
        ...XFF,
        "content-length": String(10_000_000),
      })
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 413);
    assert.equal(masterSpy.mock.callCount(), 0);
    assert.equal(chatSpy.mock.callCount(), 0);
  });

  it("returns error for oversize JD without calling the LLM", async () => {
    const chatSpy = mock.method(tailorCvDeps, "chat");
    const max = getTailorJdMaxChars();
    const body = JSON.stringify({
      jobDescription: "x".repeat(max + 1),
      sessionId: "big-jd",
    });
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(body, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
    assert.equal(chatSpy.mock.callCount(), 0);
  });

  // --- Prompt compilation ---

  it("returns error when curator prompt is missing MASTER_CV_JSON placeholder", async () => {
    mockPipelineSuccess();
    mock.method(tailorCvDeps, "compileCuratorPrompt", () => ({
      ok: false as const,
      error: "Curator prompt misconfigured",
    }));
    const chatSpy = mock.method(tailorCvDeps, "chat");
    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
    assert.equal(chatSpy.mock.callCount(), 0);
  });

  // --- Curator output validation ---

  it("returns error when curator output is not JSON", async () => {
    mockPipelineSuccess();
    mock.method(tailorCvDeps, "chat", async () => ({
      content: "sorry, here is a markdown CV instead",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "anthropic/sonnet",
      finishReason: "stop",
    }));

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 422);
  });

  it("returns error when curator JSON fails schema validation", async () => {
    mockPipelineSuccess();
    mock.method(tailorCvDeps, "chat", async () => ({
      content: JSON.stringify({ name: "Only Name" }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "anthropic/sonnet",
      finishReason: "stop",
    }));

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 422);
  });

  // --- Builder failure ---

  it("returns error when builder fails after valid curated JSON", async () => {
    mockPipelineSuccess();
    mock.method(tailorCvDeps, "buildJsonDocxBase64", async () => ({
      ok: false as const,
      error: "pack failed",
    }));

    const result = await buildTailorResponse(
      tailorCvDeps,
      buildPostRequest(VALID_BODY, XFF)
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 422);
  });

  // --- Happy path ---

  describe("happy path", () => {
    beforeEach(() => {
      mockPipelineSuccess();
    });

    it("returns ok with full response body", async () => {
      const result = await buildTailorResponse(
        tailorCvDeps,
        buildPostRequest(VALID_BODY, XFF)
      );
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(typeof result.body.cv, "string");
        assert.ok(result.body.cv.length > 0);
        assert.ok(result.body.curatedJson);
        assert.equal(result.body.builderVersion, BUILDER_VERSION);
        assert.equal(typeof result.body.remaining, "number");
        assert.equal(typeof result.body.resetTime, "number");
        assert.equal(result.body.curationMode, "strict");
        assert.equal(typeof result.body.model, "string");
        assert.ok(result.body.usage);
      }
    });

    it("returns curationMode in response", async () => {
      // Override chat to return flexible wrapper for this mode.
      mock.restoreAll();
      mockPipelineSuccess();
      mock.method(tailorCvDeps, "chat", async () => ({
        content: JSON.stringify({
          curated_cv: FIXTURE_CURATED,
          cover_letter: "Cover letter text",
        }),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "anthropic/sonnet",
        finishReason: "stop",
      }));
      const body = JSON.stringify({
        jobDescription: "React role",
        sessionId: "test",
        curationMode: "flexible",
      });
      const result = await buildTailorResponse(
        tailorCvDeps,
        buildPostRequest(body, XFF)
      );
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.body.curationMode, "flexible");
      }
    });

    it("calls pipeline steps in order (sequence check)", async () => {
      const callOrder: string[] = [];
      mock.restoreAll();
      mockPipelineSuccess();

      const origRequireMasterCv = tailorCvDeps.requireMasterCv;
      mock.method(tailorCvDeps, "requireMasterCv", () => {
        callOrder.push("requireMasterCv");
        return origRequireMasterCv();
      });

      const origGetCuratorPrompt = tailorCvDeps.getCuratorPrompt;
      mock.method(tailorCvDeps, "getCuratorPrompt", async (_mode?: string) => {
        callOrder.push("getCuratorPrompt");
        return origGetCuratorPrompt();
      });

      mock.method(tailorCvDeps, "chat", async () => {
        callOrder.push("chat");
        return {
          content: JSON.stringify(FIXTURE_CURATED),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model: "anthropic/sonnet",
          finishReason: "stop",
        };
      });

      const result = await buildTailorResponse(
        tailorCvDeps,
        buildPostRequest(VALID_BODY, XFF)
      );
      assert.equal(result.ok, true);

      const masterIdx = callOrder.indexOf("requireMasterCv");
      const promptIdx = callOrder.indexOf("getCuratorPrompt");
      const chatIdx = callOrder.indexOf("chat");
      assert.ok(masterIdx >= 0, "requireMasterCv must be invoked");
      assert.ok(promptIdx >= 0, "getCuratorPrompt must be invoked");
      assert.ok(chatIdx >= 0, "chat must be invoked");
      assert.ok(masterIdx < promptIdx, "requireMasterCv before getCuratorPrompt");
      assert.ok(promptIdx < chatIdx, "getCuratorPrompt before chat");
    });

    it("does not call LLM when auth fails before body validation (early exit)", async () => {
      mockPipelineSuccess();
      const chatSpy = mock.method(tailorCvDeps, "chat");

      await buildTailorResponse(
        tailorCvDeps,
        buildPostRequest(VALID_BODY, { "x-forwarded-for": "198.51.100.42" })
      );
      assert.equal(chatSpy.mock.callCount(), 0);
    });
  });
});
