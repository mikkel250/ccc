import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, getRateLimitConfig } from "../app/api/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows first request", () => {
    const ip = `first-${Date.now()}`;
    const result = checkRateLimit("any-session", ip);
    assert.equal(result.allowed, true);
    assert.ok(result.remaining > 0);
  });

  it("blocks when burst count exceeded", () => {
    const ip = `burst-${Date.now()}`;
    const config = getRateLimitConfig();
    for (let i = 0; i < config.maxRequests; i++) {
      const r = checkRateLimit("any-session", ip);
      assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
    }
    const blocked = checkRateLimit("any-session", ip);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
  });

  it("tracks per-IP independently", () => {
    const ipA = `ip-a-${Date.now()}`;
    const ipB = `ip-b-${Date.now()}`;
    const config = getRateLimitConfig();

    for (let i = 0; i < config.maxRequests; i++) {
      checkRateLimit("a", ipA);
    }
    const blockedA = checkRateLimit("a", ipA);
    assert.equal(blockedA.allowed, false);

    const allowedB = checkRateLimit("b", ipB);
    assert.equal(allowedB.allowed, true);
  });

  it("returns a resetTime and message when blocked", () => {
    const ip = `blocked-${Date.now()}`;
    const config = getRateLimitConfig();
    for (let i = 0; i < config.maxRequests; i++) {
      checkRateLimit("s", ip);
    }
    const blocked = checkRateLimit("s", ip);
    assert.equal(blocked.allowed, false);
    assert.ok(typeof blocked.resetTime === "number");
    assert.ok(typeof blocked.message === "string");
  });

  it("accepts default burst window config", () => {
    const config = getRateLimitConfig();
    assert.ok(config.maxRequests > 0);
    assert.ok(config.windowMs > 0);
  });
});
