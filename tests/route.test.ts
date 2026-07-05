import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST, GET } from "../app/api/tailor-cv/route";
import { RateLimitError, ServiceError } from "../app/api/lib/errors";
import { __injectRatelimitForTest, getRateLimitConfig } from "../app/api/lib/rate-limit";
import { resetRedisClientForTest } from "../app/api/lib/redis";
import { tailorCvDeps } from "../app/api/lib/tailor-cv-deps";
import { createSlidingWindowMock, createFailingMock } from "../tests/helpers/rate-limit-mock";

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
    }),
  );
}

function mockTailorPipelineSuccess() {
  mock.method(tailorCvDeps, "getAllContext", () => "KB context for tailoring.");
  mock.method(tailorCvDeps, "getCvPrompt", async () => ({
    systemPrompt: "Tailor CV with {{CONTEXT}}",
    langfusePrompt: { name: "cv-tailor-system", version: 1, isFallback: true },
  }));
  mock.method(tailorCvDeps, "compileCvPrompt", (prompt: string, context: string) =>
    prompt.replace("{{CONTEXT}}", context)
  );
  mock.method(tailorCvDeps, "chat", async () => ({
    content: "# Contact Information\nTest\n\n# Relevant Accomplishments\n- Built apps",
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: "anthropic/sonnet",
    finishReason: "stop",
  }));
  mock.method(tailorCvDeps, "isLlmServiceError", () => false);
  mock.method(tailorCvDeps, "markdownToDocxBase64", async () => "dGVzdC1jdg==");
}

function ensureEnv() {
  process.env.UPSTASH_REDIS_REST_URL =
    process.env.UPSTASH_REDIS_REST_URL || "https://test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN =
    process.env.UPSTASH_REDIS_REST_TOKEN || "test-token";
}

describe("POST /api/tailor-cv — request hardening", () => {
  beforeEach(() => {
    ensureEnv();
    resetRedisClientForTest();
    injectSlidingWindowMock();
  });

  afterEach(() => {
    mock.restoreAll();
    resetRedisClientForTest();
  });

  it("returns 400 with structured error for empty body", async () => {
    const response = await POST(buildPostRequest("", { "x-forwarded-for": "198.51.100.42" }));
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Invalid JSON in request body");
  });

  it("returns 400 for trailing-comma JSON", async () => {
    const response = await POST(
      buildPostRequest('{"jobDescription": "React role",}', { "x-forwarded-for": "198.51.100.42" })
    );
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Invalid JSON in request body");
  });

  it("returns 400 for missing IP before attempting JSON parse", async () => {
    const response = await POST(buildPostRequest('{"jobDescription": "React role",}'));
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Cannot determine client IP");
  });

  it("returns 405 for GET", async () => {
    const response = await GET();
    assert.equal(response.status, 405);
    const json = (await response.json()) as { error: string };
    assert.match(json.error, /method not allowed/i);
  });

  it("parses x-forwarded-for using the single entry before rate limiting", async () => {
    mockTailorPipelineSuccess();
    const ip = "203.0.113.1";
    const config = getRateLimitConfig();
    const header = { "x-forwarded-for": ip };

    for (let i = 0; i < config.maxRequests; i++) {
      const response = await POST(buildPostRequest(VALID_BODY, header));
      assert.equal(response.status, 200, `request ${i + 1} should succeed before limit`);
    }

    const blocked = await POST(buildPostRequest(VALID_BODY, header));
    assert.equal(blocked.status, 429);
  });

  it("trusts the rightmost x-forwarded-for entry, not a client-spoofed leftmost value", async () => {
    mockTailorPipelineSuccess();
    const spoofedIp = "10.0.0.1";
    const realIp = "203.0.113.9";
    const config = getRateLimitConfig();
    const header = { "x-forwarded-for": `${spoofedIp}, ${realIp}` };

    for (let i = 0; i < config.maxRequests; i++) {
      const response = await POST(buildPostRequest(VALID_BODY, header));
      assert.equal(response.status, 200, `request ${i + 1} should succeed before limit`);
    }

    // Exhaust the real (rightmost) identifier's bucket directly to prove
    // the route keyed on it, not on the spoofed leftmost entry.
    const blocked = await POST(buildPostRequest(VALID_BODY, header));
    assert.equal(blocked.status, 429);

    // A fresh request claiming the spoofed IP as its *only* entry still has
    // its own untouched bucket — proving the earlier requests were never
    // keyed on the spoofed value.
    const spoofedAlone = await POST(
      buildPostRequest(VALID_BODY, { "x-forwarded-for": spoofedIp })
    );
    assert.equal(spoofedAlone.status, 200);
  });

  it("returns 400 when x-forwarded-for is missing", async () => {
    const response = await POST(buildPostRequest(VALID_BODY));
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Cannot determine client IP");
  });

  it("returns 400 when x-forwarded-for contains no valid IP", async () => {
    const response = await POST(
      buildPostRequest(VALID_BODY, { "x-forwarded-for": "not-an-ip" })
    );
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Cannot determine client IP");
  });

  it("returns 400 when x-forwarded-for has out-of-range IPv4 octets", async () => {
    const response = await POST(
      buildPostRequest(VALID_BODY, { "x-forwarded-for": "999.999.999.999" })
    );
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Cannot determine client IP");
  });

  it("returns 400 when the rightmost x-forwarded-for entry is invalid even if an earlier hop is valid", async () => {
    const response = await POST(
      buildPostRequest(VALID_BODY, { "x-forwarded-for": "198.51.100.42, not-an-ip" })
    );
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Cannot determine client IP");
  });

  it("does not consume a rate-limit check when the IP cannot be determined", async () => {
    const checkRateLimitSpy = mock.method(tailorCvDeps, "checkRateLimit");

    const response = await POST(buildPostRequest(VALID_BODY));

    assert.equal(response.status, 400);
    assert.equal(checkRateLimitSpy.mock.callCount(), 0);
  });

  const XFF = { "x-forwarded-for": "198.51.100.42" };

  it("returns 429 when RateLimitError is thrown", async () => {
    mock.method(tailorCvDeps, "checkRateLimit", async () => {
      throw new RateLimitError("Too many requests. Please wait before trying again.");
    });

    const response = await POST(buildPostRequest(VALID_BODY, XFF));
    assert.equal(response.status, 429);
    const json = (await response.json()) as { error: string };
    assert.match(json.error, /too many requests/i);
  });

  it("returns 503 when rate limit ServiceError is thrown", async () => {
    __injectRatelimitForTest(createFailingMock());

    const response = await POST(buildPostRequest(VALID_BODY, XFF));
    assert.equal(response.status, 503);
    const json = (await response.json()) as { error: string };
    assert.match(json.error, /rate limit service unavailable/i);
  });

  it("returns 503 when ServiceError is thrown", async () => {
    mock.method(tailorCvDeps, "getAllContext", () => {
      throw new ServiceError("Knowledge base file experience.md is missing or unreadable");
    });

    const response = await POST(buildPostRequest(VALID_BODY, XFF));
    assert.equal(response.status, 503);
    const json = (await response.json()) as { error: string };
    assert.match(json.error, /knowledge base|unavailable|service/i);
  });

  it("returns 500 for generic Error even when message contains Rate limit", async () => {
    mock.method(tailorCvDeps, "getAllContext", () => {
      throw new Error("Rate limit policy document is outdated");
    });

    const response = await POST(buildPostRequest(VALID_BODY, XFF));
    assert.equal(response.status, 500);
    const json = (await response.json()) as { error: string };
    assert.match(json.error, /internal server error/i);
  });

  it("returns 500 for unhandled generic Error", async () => {
    mock.method(tailorCvDeps, "getAllContext", () => {
      throw new Error("unexpected failure");
    });

    const response = await POST(buildPostRequest(VALID_BODY, XFF));
    assert.equal(response.status, 500);
  });

  it("ServiceError takes precedence over the generic LLM-service mask even when its message would also match isLlmServiceError", async () => {
    // Table-ordering regression: ServiceError is checked before the generic
    // isLlmServiceError branch, so its raw message must still surface even
    // when the message text itself contains an LLM-service keyword.
    mock.method(tailorCvDeps, "getAllContext", () => {
      throw new ServiceError("openai knowledge base sync unavailable");
    });

    const response = await POST(buildPostRequest(VALID_BODY, XFF));
    assert.equal(response.status, 503);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "openai knowledge base sync unavailable");
  });

  describe("happy path with mocked pipeline", () => {
    beforeEach(() => {
      mockTailorPipelineSuccess();
    });

    it("returns 200 with base64 CV, remaining, and resetTime", async () => {
      const response = await POST(
        buildPostRequest(VALID_BODY, { "x-forwarded-for": "198.51.100.99" })
      );
      assert.equal(response.status, 200);
      const json = (await response.json()) as {
        cv: string;
        remaining: number;
        resetTime: number;
      };
      assert.equal(typeof json.cv, "string");
      assert.ok(json.cv.length > 0);
      assert.equal(typeof json.remaining, "number");
      assert.equal(typeof json.resetTime, "number");
    });
  });
});
