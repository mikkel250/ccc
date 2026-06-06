import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST, GET } from "../app/api/tailor-cv/route";
import { RateLimitError, ServiceError } from "../app/api/lib/errors";
import { resetStore, getRateLimitConfig } from "../app/api/lib/rate-limit";
import { tailorCvDeps } from "../app/api/lib/tailor-cv-deps";

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

describe("POST /api/tailor-cv — request hardening", () => {
  afterEach(() => {
    mock.restoreAll();
    resetStore();
  });

  it("returns 400 with structured error for empty body", async () => {
    const response = await POST(buildPostRequest(""));
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Invalid JSON in request body");
  });

  it("returns 400 for trailing-comma JSON", async () => {
    const response = await POST(
      buildPostRequest('{"jobDescription": "React role",}')
    );
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Invalid JSON in request body");
  });

  it("returns 405 for GET", async () => {
    const response = await GET();
    assert.equal(response.status, 405);
    const json = (await response.json()) as { error: string };
    assert.match(json.error, /method not allowed/i);
  });

  it("parses x-forwarded-for to leftmost IP before rate limiting", async () => {
    const ip = "203.0.113.1";
    const config = getRateLimitConfig();
    const header = { "x-forwarded-for": `${ip}, 10.0.0.1` };

    for (let i = 0; i < config.maxRequests; i++) {
      const response = await POST(buildPostRequest(VALID_BODY, header));
      assert.notEqual(response.status, 429, `request ${i + 1} should not be rate limited yet`);
    }

    const blocked = await POST(buildPostRequest(VALID_BODY, header));
    assert.equal(blocked.status, 429);
  });

  it('uses "unknown" IP when forwarding headers are missing', async () => {
    const config = getRateLimitConfig();

    for (let i = 0; i < config.maxRequests; i++) {
      await POST(buildPostRequest(VALID_BODY));
    }

    const blocked = await POST(buildPostRequest(VALID_BODY));
    assert.equal(blocked.status, 429);
  });

  it("returns 429 when RateLimitError is thrown", async () => {
    mock.method(tailorCvDeps, "checkRateLimit", async () => {
      throw new RateLimitError("Too many requests. Please wait before trying again.");
    });

    const response = await POST(buildPostRequest(VALID_BODY));
    assert.equal(response.status, 429);
    const json = (await response.json()) as { error: string };
    assert.match(json.error, /too many requests/i);
  });

  it("returns 503 when ServiceError is thrown", async () => {
    mock.method(tailorCvDeps, "getAllContext", () => {
      throw new ServiceError("Knowledge base file experience.md is missing or unreadable");
    });

    const response = await POST(buildPostRequest(VALID_BODY));
    assert.equal(response.status, 503);
    const json = (await response.json()) as { error: string };
    assert.match(json.error, /knowledge base|unavailable|service/i);
  });

  it("returns 500 for generic Error even when message contains Rate limit", async () => {
    mock.method(tailorCvDeps, "getAllContext", () => {
      throw new Error("Rate limit policy document is outdated");
    });

    const response = await POST(buildPostRequest(VALID_BODY));
    assert.equal(response.status, 500);
    const json = (await response.json()) as { error: string };
    assert.match(json.error, /internal server error/i);
  });

  it("returns 500 for unhandled generic Error", async () => {
    mock.method(tailorCvDeps, "getAllContext", () => {
      throw new Error("unexpected failure");
    });

    const response = await POST(buildPostRequest(VALID_BODY));
    assert.equal(response.status, 500);
  });

  describe("happy path with mocked pipeline", () => {
    beforeEach(() => {
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
    });

    it("returns 200 with base64 CV, remaining, and resetTime", async () => {
      resetStore();
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
