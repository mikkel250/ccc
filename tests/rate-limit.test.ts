import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  getRateLimitConfig,
  __injectRatelimitForTest,
  __injectSecretRatelimitForTest,
  hashTailorApiKeyForRateLimit,
} from "../app/api/lib/rate-limit";
import { resetRedisClientForTest } from "../app/api/lib/redis";

import {
  createSlidingWindowMock,
  createFailingMock,
  createTimeoutMock,
} from "../tests/helpers/rate-limit-mock";

// ---- Helpers ----

// Single source of truth for expected config — avoids duplicating env parsing
// (see getEnvNumber in lib/env.ts). RATE_LIMIT_MAX/WINDOW are read once at
// module load in rate-limit.ts, so this reflects the same fixed values.
const config = getRateLimitConfig();
const SECRET_BUCKET = hashTailorApiKeyForRateLimit("test-secret");

function ensureEnv() {
  process.env.UPSTASH_REDIS_REST_URL =
    process.env.UPSTASH_REDIS_REST_URL || "https://test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN =
    process.env.UPSTASH_REDIS_REST_TOKEN || "test-token";
}

// ---- Tests ----

describe("checkRateLimit", () => {
  beforeEach(() => {
    ensureEnv();
    resetRedisClientForTest();
    __injectRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: config.maxRequests,
        windowMs: config.windowMs,
      })
    );
    // Match IP ceiling so IP-focused tests are not tripped by the tighter secret default
    __injectSecretRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: config.maxRequests,
        windowMs: config.windowMs,
      })
    );
  });

  afterEach(() => {
    resetRedisClientForTest();
  });

  it("allows first request", async () => {
    const result = await checkRateLimit("any-session", `first-${Date.now()}`, SECRET_BUCKET);
    assert.equal(result.allowed, true);
    assert.ok(result.remaining > 0);
  });

  it("blocks when burst count exceeded", async () => {
    const identifier = `burst-${Date.now()}`;
    for (let i = 0; i < config.maxRequests; i++) {
      const r = await checkRateLimit("any-session", identifier, SECRET_BUCKET);
      assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
    }
    const blocked = await checkRateLimit("any-session", identifier, SECRET_BUCKET);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
  });

  it("tracks per-identifier independently", async () => {
    const idA = `ip-a-${Date.now()}`;
    const idB = `ip-b-${Date.now()}`;
    const secretA = hashTailorApiKeyForRateLimit(`a-${Date.now()}`);
    const secretB = hashTailorApiKeyForRateLimit(`b-${Date.now()}`);

    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit("a", idA, secretA);
    }
    const blockedA = await checkRateLimit("a", idA, secretA);
    assert.equal(blockedA.allowed, false);

    const allowedB = await checkRateLimit("b", idB, secretB);
    assert.equal(allowedB.allowed, true);
  });

  it("returns resetTime when blocked", async () => {
    const identifier = `blocked-${Date.now()}`;
    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit("s", identifier, SECRET_BUCKET);
    }
    const blocked = await checkRateLimit("s", identifier, SECRET_BUCKET);
    assert.equal(blocked.allowed, false);
    assert.equal(
      blocked.message,
      "Too many requests. Please wait before trying again."
    );
    assert.ok(typeof blocked.resetTime === "number");
    assert.ok(blocked.resetTime! > Date.now());
  });

  it("rate limits by identifier regardless of sessionId", async () => {
    const identifier = `session-ip-${Date.now()}`;

    await checkRateLimit("session-A", identifier, SECRET_BUCKET);
    await checkRateLimit("session-B", identifier, SECRET_BUCKET);

    for (let i = 2; i < config.maxRequests; i++) {
      await checkRateLimit(`session-${i}`, identifier, SECRET_BUCKET);
    }

    const blocked = await checkRateLimit("session-Z", identifier, SECRET_BUCKET);
    assert.equal(blocked.allowed, false);
  });

  it("serializes concurrent same-identifier requests so allowed count never exceeds maxRequests", async () => {
    const identifier = `concurrent-${Date.now()}`;
    const totalCalls = config.maxRequests + 2;

    const results = await Promise.all(
      Array.from({ length: totalCalls }, () =>
        checkRateLimit("session", identifier, SECRET_BUCKET)
      )
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    const blockedCount = results.filter((r) => !r.allowed).length;

    assert.equal(allowedCount, config.maxRequests);
    assert.equal(blockedCount, 2);
  });

  it("isolates concurrent requests per identifier", async () => {
    const idA = `iso-a-${Date.now()}`;
    const idB = `iso-b-${Date.now()}`;
    const secretA = hashTailorApiKeyForRateLimit(`iso-a-${Date.now()}`);
    const secretB = hashTailorApiKeyForRateLimit(`iso-b-${Date.now()}`);

    const resultsA = await Promise.all(
      Array.from({ length: config.maxRequests + 1 }, () =>
        checkRateLimit("s", idA, secretA)
      )
    );
    const resultsB = await Promise.all(
      Array.from({ length: config.maxRequests }, () =>
        checkRateLimit("s", idB, secretB)
      )
    );

    assert.equal(
      resultsA.filter((r) => r.allowed).length,
      config.maxRequests
    );
    assert.equal(
      resultsB.filter((r) => r.allowed).length,
      config.maxRequests
    );
  });
  it("blocks when secret bucket is exhausted even if IP bucket is free", async () => {
    __injectSecretRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: config.secretMaxRequests,
        windowMs: config.windowMs,
      })
    );
    const ip = `ip-free-${Date.now()}`;
    const secret = hashTailorApiKeyForRateLimit(`tight-${Date.now()}`);
    for (let i = 0; i < config.secretMaxRequests; i++) {
      const r = await checkRateLimit("s", `${ip}-${i}`, secret);
      assert.equal(r.allowed, true, `secret request ${i + 1} should be allowed`);
    }
    const blocked = await checkRateLimit("s", `${ip}-new`, secret);
    assert.equal(blocked.allowed, false);
  });

  it("returns the more restrictive remaining of the two buckets", async () => {
    __injectSecretRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: config.secretMaxRequests,
        windowMs: config.windowMs,
      })
    );
    const ip = `ip-min-${Date.now()}`;
    const secret = hashTailorApiKeyForRateLimit(`min-${Date.now()}`);
    const result = await checkRateLimit("s", ip, secret);
    assert.equal(result.allowed, true);
    assert.equal(
      result.remaining,
      Math.min(config.maxRequests, config.secretMaxRequests) - 1
    );
  });

});

describe("checkRateLimit — error paths", () => {
  beforeEach(() => {
    ensureEnv();
    resetRedisClientForTest();
  });

  afterEach(() => {
    resetRedisClientForTest();
  });

  it("throws ServiceError when Ratelimit.limit() rejects, preserving cause", async () => {
    __injectRatelimitForTest(createFailingMock());
    __injectSecretRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: config.maxRequests,
        windowMs: config.windowMs,
      })
    );

    await assert.rejects(
      () => checkRateLimit("s", `fail-${Date.now()}`, SECRET_BUCKET),
      (err: unknown) => {
        return err instanceof Error &&
               err.name === "ServiceError" &&
               err.message === "Rate limit service unavailable" &&
               (err as Error).cause instanceof Error &&
               ((err as Error).cause as Error).message === "Connection refused";
      }
    );
  });

  it("throws ServiceError when limit returns timeout reason", async () => {
    __injectRatelimitForTest(createTimeoutMock());
    __injectSecretRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: config.maxRequests,
        windowMs: config.windowMs,
      })
    );

    await assert.rejects(
      () => checkRateLimit("s", `timeout-${Date.now()}`, SECRET_BUCKET),
      (err: unknown) => {
        return err instanceof Error &&
               err.name === "ServiceError" &&
               err.message === "Rate limit service unavailable";
      }
    );
  });
});

describe("checkRateLimit — missing env vars", () => {
  beforeEach(() => {
    __injectRatelimitForTest(null); // Force re-creation, no cached mock
    __injectSecretRatelimitForTest(null);
  });

  afterEach(() => {
    resetRedisClientForTest();
    ensureEnv();
  });

  it("throws when UPSTASH_REDIS_REST_URL is missing", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    resetRedisClientForTest();
    __injectRatelimitForTest(null); // Force re-creation on next call
    __injectSecretRatelimitForTest(null);

    await assert.rejects(
      () => checkRateLimit("s", `missing-url-${Date.now()}`, SECRET_BUCKET),
      (err: unknown) => /UPSTASH_REDIS_REST_URL/i.test((err as Error).message)
    );
  });

  it("throws when UPSTASH_REDIS_REST_TOKEN is missing", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://test.upstash.io";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRedisClientForTest();
    __injectRatelimitForTest(null); // Force re-creation on next call
    __injectSecretRatelimitForTest(null);

    await assert.rejects(
      () => checkRateLimit("s", `missing-token-${Date.now()}`, SECRET_BUCKET),
      (err: unknown) => /UPSTASH_REDIS_REST_TOKEN/i.test((err as Error).message)
    );
  });
});

describe("getRateLimitConfig", () => {
  beforeEach(() => {
    ensureEnv();
    resetRedisClientForTest();
  });

  it("returns maxRequests, secretMaxRequests, and windowMs from env", () => {
    const cfg = getRateLimitConfig();
    assert.ok(cfg.maxRequests > 0);
    assert.ok(cfg.secretMaxRequests > 0);
    assert.ok(cfg.windowMs > 0);
    assert.ok(cfg.timeoutMs > 0);
    assert.equal(cfg.maxRequests, config.maxRequests);
    assert.equal(cfg.secretMaxRequests, config.secretMaxRequests);
    assert.equal(cfg.windowMs, config.windowMs);
  });
});

describe("test-only exports", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("__injectRatelimitForTest throws outside test environment", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () => __injectRatelimitForTest(null),
      /only available in the test environment/i
    );
  });
});
