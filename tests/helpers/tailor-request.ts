/**
 * Shared HTTP/env helpers for tailor pipeline route-style tests.
 */
import { NextRequest } from "next/server";
import {
  __injectRatelimitForTest,
  __injectSecretRatelimitForTest,
  getRateLimitConfig,
} from "../../app/api/lib/rate-limit";
import { createSlidingWindowMock } from "./rate-limit-mock";

export const TEST_API_KEY = "test-tailor-api-key";

export function authHeaders(
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    authorization: `Bearer ${TEST_API_KEY}`,
    ...extra,
  };
}

export function buildPostRequest(
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

export function injectSlidingWindowMock(): void {
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

export function ensureEnv(options?: {
  critiqueReviseEnabled?: boolean;
}): void {
  process.env.UPSTASH_REDIS_REST_URL =
    process.env.UPSTASH_REDIS_REST_URL || "https://test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN =
    process.env.UPSTASH_REDIS_REST_TOKEN || "test-token";
  process.env.TAILOR_API_KEY = TEST_API_KEY;
  delete process.env.TAILOR_AUTH_INSECURE_BYPASS;
  process.env.NODE_ENV = "test";
  if (options?.critiqueReviseEnabled === true) {
    process.env.CRITIQUE_REVISE_ENABLED = "true";
  } else if (options?.critiqueReviseEnabled === false) {
    process.env.CRITIQUE_REVISE_ENABLED = "false";
  }
}
