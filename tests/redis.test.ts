import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getRateLimitConfig } from "../app/api/lib/rate-limit";
import { getRedisClient, resetRedisClientForTest } from "../app/api/lib/redis";
import { getEnvNumber } from "../lib/env";

describe("getRedisClient", () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  afterEach(() => {
    resetRedisClientForTest();
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  });

  it("throws when UPSTASH_REDIS_REST_URL is missing", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    assert.throws(() => getRedisClient(), /UPSTASH_REDIS_REST_URL/i);
  });

  it("throws when UPSTASH_REDIS_REST_TOKEN is missing", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    assert.throws(() => getRedisClient(), /UPSTASH_REDIS_REST_TOKEN/i);
  });

  it("returns a Redis client when env vars are set", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    const client = getRedisClient();
    assert.equal(typeof client, "object");
    assert.notEqual(client, null);
  });

  it("returns the same singleton instance on subsequent calls", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    const first = getRedisClient();
    const second = getRedisClient();
    assert.equal(first, second);
  });

  it("resetRedisClientForTest throws outside test environment", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.throws(
        () => resetRedisClientForTest(),
        /only available in the test environment/i
      );
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });
});

describe("Upstash rate limit runtime config", () => {
  it("getRateLimitConfig timeoutMs matches the Upstash SDK timeout wired in rate-limit.ts", () => {
    const expectedTimeoutMs = Math.max(
      1,
      Math.floor(getEnvNumber("RATE_LIMIT_TIMEOUT_MS", 2000))
    );
    assert.equal(getRateLimitConfig().timeoutMs, expectedTimeoutMs);
  });
});
