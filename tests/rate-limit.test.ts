import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  getRateLimitConfig,
  resetStore,
  getBucketLengthForTest,
  seedBucketForTest,
  hasRequestLogEntryForTest,
  hasIpChainEntryForTest,
} from "../app/api/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows first request", async () => {
    const ip = `first-${Date.now()}`;
    const result = await checkRateLimit("any-session", ip);
    assert.equal(result.allowed, true);
    assert.ok(result.remaining > 0);
  });

  it("blocks when burst count exceeded", async () => {
    const ip = `burst-${Date.now()}`;
    const config = getRateLimitConfig();
    for (let i = 0; i < config.maxRequests; i++) {
      const r = await checkRateLimit("any-session", ip);
      assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
    }
    const blocked = await checkRateLimit("any-session", ip);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
  });

  it("tracks per-IP independently", async () => {
    const ipA = `ip-a-${Date.now()}`;
    const ipB = `ip-b-${Date.now()}`;
    const config = getRateLimitConfig();

    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit("a", ipA);
    }
    const blockedA = await checkRateLimit("a", ipA);
    assert.equal(blockedA.allowed, false);

    const allowedB = await checkRateLimit("b", ipB);
    assert.equal(allowedB.allowed, true);
  });

  it("returns a resetTime and message when blocked", async () => {
    const ip = `blocked-${Date.now()}`;
    const config = getRateLimitConfig();
    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit("s", ip);
    }
    const blocked = await checkRateLimit("s", ip);
    assert.equal(blocked.allowed, false);
    assert.ok(typeof blocked.resetTime === "number");
    assert.ok(typeof blocked.message === "string");
  });

  it("accepts default burst window config", () => {
    const config = getRateLimitConfig();
    assert.ok(config.maxRequests > 0);
    assert.ok(config.windowMs > 0);
  });

  it("allows requests again after resetStore clears expired state", async () => {
    const ip = `reset-${Date.now()}`;
    const config = getRateLimitConfig();

    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit("any-session", ip);
    }
    const blocked = await checkRateLimit("any-session", ip);
    assert.equal(blocked.allowed, false);

    resetStore();

    const allowed = await checkRateLimit("any-session", ip);
    assert.equal(allowed.allowed, true);
  });

  it("rate limits by IP regardless of sessionId", async () => {
    const ip = `session-ip-${Date.now()}`;
    const config = getRateLimitConfig();

    const first = await checkRateLimit("session-A", ip);
    assert.equal(first.allowed, true);

    const second = await checkRateLimit("session-B", ip);
    assert.equal(second.allowed, true);

    for (let i = 2; i < config.maxRequests; i++) {
      await checkRateLimit(`session-${i}`, ip);
    }

    const blocked = await checkRateLimit("session-Z", ip);
    assert.equal(blocked.allowed, false);
  });
});

describe("checkRateLimit — idle map pruning", () => {
  it("drops expired-only requestLog entry when the same IP returns", async () => {
    resetStore();
    const config = getRateLimitConfig();
    const ip = `revisit-${Date.now()}`;
    const expiredTimestamp = Date.now() - config.windowMs - 1000;

    seedBucketForTest(ip, [expiredTimestamp, expiredTimestamp]);
    assert.equal(hasRequestLogEntryForTest(ip), true);

    const result = await checkRateLimit("session", ip);

    assert.equal(result.allowed, true);
    assert.equal(getBucketLengthForTest(ip), 1);
    assert.ok(getBucketLengthForTest(ip) > 0);
  });

  it("prunes requestLog and ipChains after the burst window expires without revisit", async () => {
    resetStore();
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const ip = `idle-${Date.now()}`;
      const config = getRateLimitConfig();

      await checkRateLimit("session", ip);
      assert.equal(hasRequestLogEntryForTest(ip), true);
      assert.equal(hasIpChainEntryForTest(ip), true);

      mock.timers.tick(config.windowMs + 1);

      assert.equal(hasRequestLogEntryForTest(ip), false);
      assert.equal(hasIpChainEntryForTest(ip), false);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("checkRateLimit — per-IP pruning", () => {
  it("does not prune another IP's expired bucket entries", async () => {
    resetStore();
    const config = getRateLimitConfig();
    const ipA = `prune-a-${Date.now()}`;
    const ipB = `prune-b-${Date.now()}`;
    const expiredTimestamp = Date.now() - config.windowMs - 1000;

    seedBucketForTest(ipB, [expiredTimestamp, expiredTimestamp]);
    const ipBLengthBefore = getBucketLengthForTest(ipB);

    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit("session", ipA);
    }

    await checkRateLimit("session", ipA);

    assert.equal(getBucketLengthForTest(ipB), ipBLengthBefore);
  });
});

describe("checkRateLimit — accurate resetTime", () => {
  it("first allowed request: resetTime equals only timestamp + window", async () => {
    resetStore();
    const ip = `reset-first-${Date.now()}`;
    const config = getRateLimitConfig();
    const before = Date.now();

    const result = await checkRateLimit("s", ip);

    const after = Date.now();
    assert.equal(result.allowed, true);
    assert.ok(result.resetTime! >= before + config.windowMs);
    assert.ok(result.resetTime! <= after + config.windowMs);
  });

  it("mid-burst allowed request: resetTime uses oldest timestamp, not now + window", async () => {
    resetStore();
    const ip = `reset-mid-${Date.now()}`;
    const config = getRateLimitConfig();

    const first = await checkRateLimit("s", ip);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await checkRateLimit("s", ip);

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(second.resetTime, first.resetTime);
    assert.ok(second.resetTime! < Date.now() + config.windowMs - 5);
  });

  it("blocked request: resetTime uses oldest timestamp + window", async () => {
    resetStore();
    const ip = `reset-blocked-${Date.now()}`;
    const config = getRateLimitConfig();

    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit("s", ip);
    }

    const blocked = await checkRateLimit("s", ip);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.resetTime! <= Date.now() + config.windowMs);
    assert.ok(blocked.resetTime! >= Date.now());
  });
});

describe("checkRateLimit — per-IP promise-chain serialization", () => {
  it("serializes concurrent same-IP burst so allowed count never exceeds maxRequests", async () => {
    resetStore();
    const ip = `concurrent-${Date.now()}`;
    const config = getRateLimitConfig();
    const totalCalls = config.maxRequests + 2;

    const results = await Promise.all(
      Array.from({ length: totalCalls }, () => checkRateLimit("session", ip))
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    const blockedCount = results.filter((r) => !r.allowed).length;

    assert.equal(allowedCount, config.maxRequests);
    assert.equal(blockedCount, 2);
  });

  it("isolates concurrent requests per IP", async () => {
    resetStore();
    const config = getRateLimitConfig();
    const ipA = `iso-a-${Date.now()}`;
    const ipB = `iso-b-${Date.now()}`;

    const resultsA = await Promise.all(
      Array.from({ length: config.maxRequests + 1 }, () => checkRateLimit("s", ipA))
    );
    const resultsB = await Promise.all(
      Array.from({ length: config.maxRequests }, () => checkRateLimit("s", ipB))
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
});
