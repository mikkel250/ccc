import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  getRateLimitConfig,
  resolveCallerRateLimitKey,
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

  it("does not share per-caller buckets across session-prefixed identifiers", async () => {
    const ip = "127.0.0.1";
    const keyA = resolveCallerRateLimitKey("user-a", ip);
    const keyB = resolveCallerRateLimitKey("user-b", ip);
    const secretA = hashTailorApiKeyForRateLimit(`sess-a-${Date.now()}`);
    const secretB = hashTailorApiKeyForRateLimit(`sess-b-${Date.now()}`);
    assert.notEqual(keyA, keyB);

    for (let i = 0; i < config.maxRequests; i++) {
      const r = await checkRateLimit("any-session", keyA, secretA);
      assert.equal(r.allowed, true, `user-a request ${i + 1} should be allowed`);
    }
    const blockedA = await checkRateLimit("any-session", keyA, secretA);
    assert.equal(blockedA.allowed, false);

    const allowedB = await checkRateLimit("any-session", keyB, secretB);
    assert.equal(allowedB.allowed, true);
  });

  it("keeps the same session-prefixed bucket when the IP changes", async () => {
    const callerMax = config.maxRequests;
    __injectRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: callerMax,
        windowMs: config.windowMs,
      })
    );
    // Above the caller ceiling so the shared secret cannot reject the loop
    // before the session bucket is exercised.
    __injectSecretRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: callerMax + 1,
        windowMs: config.windowMs,
      })
    );
    const sessionId = `user-stable-${Date.now()}`;
    const secret = hashTailorApiKeyForRateLimit(`stable-${sessionId}`);
    const keyA = resolveCallerRateLimitKey(sessionId, "198.51.100.1");
    const keyB = resolveCallerRateLimitKey(sessionId, "198.51.100.2");
    assert.equal(keyA, keyB);

    for (let i = 0; i < callerMax; i++) {
      const r = await checkRateLimit("any-session", keyA, secret);
      assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
    }
    const blocked = await checkRateLimit("any-session", keyB, secret);
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
      assert.equal(
        r.remaining,
        config.secretMaxRequests - (i + 1),
        `secret bucket remaining should decrement on request ${i + 1}`
      );
    }
    const blocked = await checkRateLimit("s", `${ip}-new`, secret);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(typeof blocked.resetTime, "number");
    const now = Date.now();
    assert.ok(blocked.resetTime! > now);
    assert.ok(blocked.resetTime! - now <= config.windowMs);
  });

  it("does not spend the shared secret window when the caller is already at its ceiling", async () => {
    const callerMax = 2;
    const secretMax = 10;
    assert.ok(secretMax > callerMax);
    __injectRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: callerMax,
        windowMs: config.windowMs,
      })
    );
    const secretInner = createSlidingWindowMock({
      maxRequests: secretMax,
      windowMs: config.windowMs,
    });
    let secretCalls = 0;
    __injectSecretRatelimitForTest({
      getRemaining: (identifier) => secretInner.getRemaining(identifier),
      limit: async (identifier: string) => {
        secretCalls += 1;
        return secretInner.limit(identifier);
      },
    });
    const secret = hashTailorApiKeyForRateLimit(`over-cap-${Date.now()}`);
    const callerA = `session:user-a-${Date.now()}`;
    const callerB = `session:user-b-${Date.now()}`;

    for (let i = 0; i < callerMax; i++) {
      const allowed = await checkRateLimit("s", callerA, secret);
      assert.equal(allowed.allowed, true, `caller A request ${i + 1} should be allowed`);
    }
    assert.equal(secretCalls, callerMax);

    const blocked = await checkRateLimit("s", callerA, secret);
    assert.equal(blocked.allowed, false);
    assert.equal(
      secretCalls,
      callerMax,
      "a retry past the caller ceiling must not increment the secret bucket"
    );

    const other = await checkRateLimit("s", callerB, secret);
    assert.equal(other.allowed, true);
    assert.equal(secretCalls, callerMax + 1);
  });

  it("does not consume IP quota when secret bucket alone denies", async () => {
    __injectSecretRatelimitForTest(
      createSlidingWindowMock({
        maxRequests: 1,
        windowMs: config.windowMs,
      })
    );
    const ipInner = createSlidingWindowMock({
      maxRequests: 100,
      windowMs: config.windowMs,
    });
    let ipCalls = 0;
    __injectRatelimitForTest({
      getRemaining: (identifier) => ipInner.getRemaining(identifier),
      limit: async (identifier: string) => {
        ipCalls += 1;
        return ipInner.limit(identifier);
      },
    });
    const secret = hashTailorApiKeyForRateLimit(`no-ip-burn-${Date.now()}`);
    const first = await checkRateLimit("s", `ip-a-${Date.now()}`, secret);
    assert.equal(first.allowed, true);
    assert.equal(ipCalls, 1);
    const blocked = await checkRateLimit("s", `ip-b-${Date.now()}`, secret);
    assert.equal(blocked.allowed, false);
    assert.equal(ipCalls, 1);
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

  it("does not read Redis again while a caller denial is still inside its reset", async () => {
    let peeks = 0;
    const reset = Date.now() + config.windowMs;
    __injectRatelimitForTest({
      getRemaining: async () => {
        peeks += 1;
        return { remaining: 0, reset, limit: 1 };
      },
      limit: async () => {
        throw new Error("caller limit should not run");
      },
    });
    __injectSecretRatelimitForTest({
      getRemaining: async () => {
        throw new Error("secret peek should not run");
      },
      limit: async () => {
        throw new Error("secret limit should not run");
      },
    });
    const caller = `cached-caller-${Date.now()}`;
    const secret = hashTailorApiKeyForRateLimit(`cached-caller-${caller}`);
    const first = await checkRateLimit("s", caller, secret);
    assert.equal(first.allowed, false);
    assert.equal(peeks, 1);

    const second = await checkRateLimit("s", caller, secret);
    assert.equal(second.allowed, false);
    assert.equal(second.resetTime, first.resetTime);
    assert.equal(peeks, 1);

    await checkRateLimit("s", `other-${caller}`, secret);
    assert.equal(peeks, 2);
  });

  it("does not read Redis again while a secret denial is still inside its reset", async () => {
    let peeks = 0;
    let secretLimits = 0;
    const reset = Date.now() + config.windowMs;
    __injectRatelimitForTest({
      getRemaining: async () => {
        peeks += 1;
        return { remaining: 5, reset, limit: 5 };
      },
      limit: async () => {
        throw new Error("caller limit should not run when the secret denies");
      },
    });
    __injectSecretRatelimitForTest({
      getRemaining: async () => ({ remaining: 0, reset, limit: 1 }),
      limit: async () => {
        secretLimits += 1;
        return {
          success: false,
          remaining: 0,
          reset,
          limit: 1,
          pending: Promise.resolve(),
        };
      },
    });
    const secret = hashTailorApiKeyForRateLimit(`cached-secret-${Date.now()}`);
    const first = await checkRateLimit("s", `ip-a-${secret}`, secret);
    assert.equal(first.allowed, false);
    assert.equal(secretLimits, 1);
    assert.equal(peeks, 1);

    const second = await checkRateLimit("s", `ip-b-${secret}`, secret);
    assert.equal(second.allowed, false);
    assert.equal(secretLimits, 1);
    assert.equal(peeks, 1);

    const otherSecret = hashTailorApiKeyForRateLimit(`other-secret-${secret}`);
    const proceeded = await checkRateLimit("s", `ip-c-${secret}`, otherSecret);
    assert.equal(proceeded.allowed, false);
    assert.equal(secretLimits, 2);
    assert.equal(peeks, 2);
  });

  it("reads Redis again once a cached denial reaches its reset", async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    try {
      let peeks = 0;
      const reset = Date.now() + 1_000;
      __injectRatelimitForTest({
        getRemaining: async () => {
          peeks += 1;
          return { remaining: 0, reset, limit: 1 };
        },
        limit: async () => {
          throw new Error("caller limit should not run");
        },
      });
      __injectSecretRatelimitForTest({
        getRemaining: async () => {
          throw new Error("secret peek should not run");
        },
        limit: async () => {
          throw new Error("secret limit should not run");
        },
      });
      const caller = "cached-expiry";
      await checkRateLimit("s", caller, "secret-expiry");
      await checkRateLimit("s", caller, "secret-expiry");
      assert.equal(peeks, 1);
      mock.timers.tick(1_000);
      await checkRateLimit("s", caller, "secret-expiry");
      assert.equal(peeks, 2);
    } finally {
      mock.timers.reset();
    }
  });

  it("rechecks Redis within one window when the limiter reset is farther out", async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    try {
      let peeks = 0;
      const reset = Date.now() + config.windowMs * 10;
      __injectRatelimitForTest({
        getRemaining: async () => {
          peeks += 1;
          return { remaining: 0, reset, limit: 1 };
        },
        limit: async () => {
          throw new Error("caller limit should not run");
        },
      });
      __injectSecretRatelimitForTest({
        getRemaining: async () => {
          throw new Error("secret peek should not run");
        },
        limit: async () => {
          throw new Error("secret limit should not run");
        },
      });
      const caller = "cached-bound";
      const denied = await checkRateLimit("s", caller, "secret-bound");
      assert.equal(denied.allowed, false);
      assert.ok(denied.resetTime <= Date.now() + config.windowMs);
      await checkRateLimit("s", caller, "secret-bound");
      assert.equal(peeks, 1);
      mock.timers.tick(config.windowMs);
      await checkRateLimit("s", caller, "secret-bound");
      assert.equal(peeks, 2);
    } finally {
      mock.timers.reset();
    }
  });

  it("checks Redis again for the oldest denial once the local cache is full", async () => {
    const cap = config.denialCacheMax;
    const peeks = new Map<string, number>();
    const reset = Date.now() + config.windowMs;
    __injectRatelimitForTest({
      getRemaining: async (identifier: string) => {
        peeks.set(identifier, (peeks.get(identifier) ?? 0) + 1);
        return { remaining: 0, reset, limit: 1 };
      },
      limit: async () => {
        throw new Error("caller limit should not run");
      },
    });
    __injectSecretRatelimitForTest({
      getRemaining: async () => {
        throw new Error("secret peek should not run");
      },
      limit: async () => {
        throw new Error("secret limit should not run");
      },
    });
    for (let i = 0; i <= cap; i++) {
      const denied = await checkRateLimit("s", `fill-${i}`, "secret-fill");
      assert.equal(denied.allowed, false);
    }
    assert.equal(peeks.get("fill-0"), 1);
    await checkRateLimit("s", "fill-0", "secret-fill");
    assert.equal(peeks.get("fill-0"), 2);
    await checkRateLimit("s", `fill-${cap}`, "secret-fill");
    assert.equal(peeks.get(`fill-${cap}`), 1);
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

  it("fails closed when the caller peek does not return, without consuming the secret bucket", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let secretCalls = 0;
      __injectRatelimitForTest({
        getRemaining: () => new Promise(() => undefined),
        limit: async () => {
          throw new Error("caller limit should not run");
        },
      });
      __injectSecretRatelimitForTest({
        getRemaining: async () => ({
          remaining: 1,
          reset: Date.now() + config.windowMs,
          limit: config.secretMaxRequests,
        }),
        limit: async () => {
          secretCalls += 1;
          throw new Error("secret limit should not run");
        },
      });
      const pending = checkRateLimit("s", `peek-hang-${Date.now()}`, SECRET_BUCKET);
      const assertion = assert.rejects(pending, (err: unknown) => {
        return err instanceof Error &&
          err.name === "ServiceError" &&
          err.message === "Rate limit service unavailable";
      });
      mock.timers.tick(config.timeoutMs);
      await assertion;
      assert.equal(secretCalls, 0);
    } finally {
      mock.timers.reset();
    }
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

describe("resolveCallerRateLimitKey", () => {
  const ip = "203.0.113.9";

  it("prefixes a usable sessionId so it cannot collide with an IP key", () => {
    assert.equal(resolveCallerRateLimitKey("user_a-1", ip), "session:user_a-1");
    assert.notEqual(resolveCallerRateLimitKey("user_a-1", ip), "user_a-1");
    assert.notEqual(resolveCallerRateLimitKey("user_a-1", ip), ip);
  });

  it("falls back to the IP when sessionId is missing or not a usable string", () => {
    assert.equal(resolveCallerRateLimitKey(undefined, ip), ip);
    assert.equal(resolveCallerRateLimitKey("", ip), ip);
    assert.equal(resolveCallerRateLimitKey("   ", ip), ip);
    assert.equal(resolveCallerRateLimitKey("user@id", ip), ip);
    assert.equal(resolveCallerRateLimitKey("user id", ip), ip);
    assert.equal(resolveCallerRateLimitKey("127.0.0.1", ip), ip);
    assert.equal(resolveCallerRateLimitKey("a".repeat(129), ip), ip);
    assert.equal(resolveCallerRateLimitKey(12, ip), ip);
  });

  it("trims a usable sessionId before prefixing", () => {
    assert.equal(resolveCallerRateLimitKey("  user-a  ", ip), "session:user-a");
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
    assert.ok(cfg.sessionIdMaxChars > 0);
    assert.ok(cfg.denialCacheMax > 0);
    assert.equal(cfg.maxRequests, config.maxRequests);
    assert.equal(cfg.secretMaxRequests, config.secretMaxRequests);
    assert.equal(cfg.windowMs, config.windowMs);
    assert.equal(cfg.sessionIdMaxChars, config.sessionIdMaxChars);
  });
});

describe("hashTailorApiKeyForRateLimit", () => {
  it("returns a stable 32-char hex digest that omits the raw secret", () => {
    const secret = "super-secret-tailor-key";
    const first = hashTailorApiKeyForRateLimit(secret);
    const second = hashTailorApiKeyForRateLimit(secret);
    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{32}$/);
    assert.equal(first.includes(secret), false);
  });

  it("maps distinct secrets to distinct bucket keys", () => {
    const a = hashTailorApiKeyForRateLimit("unauth:invalid");
    const b = hashTailorApiKeyForRateLimit("unauth:missing");
    assert.notEqual(a, b);
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

  it("__injectSecretRatelimitForTest throws outside test environment", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () => __injectSecretRatelimitForTest(null),
      /only available in the test environment/i
    );
  });
});
