import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateTailorRequest,
  bearerTokenEquals,
  ensureSecureStartup,
  getStartupSecurityError,
  isProductionLikeDeploy,
  parseBearerToken,
} from "../app/api/lib/tailor-auth";

const ORIGINAL_ENV = { ...process.env };

function resetAuthEnv() {
  delete process.env.TAILOR_API_KEY;
  delete process.env.TAILOR_AUTH_INSECURE_BYPASS;
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.VERCEL_ENV;
  // Keep NODE_ENV as "test" from the test runner harness.
  process.env.NODE_ENV = "test";
}

describe("tailor-auth", () => {
  beforeEach(() => {
    resetAuthEnv();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects missing Authorization when a key is configured", () => {
    process.env.TAILOR_API_KEY = "secret-key";
    const result = authenticateTailorRequest(null);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 401);
      assert.equal(result.error, "Unauthorized");
    }
  });

  it("rejects wrong Bearer token", () => {
    process.env.TAILOR_API_KEY = "secret-key";
    const result = authenticateTailorRequest("Bearer wrong");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 401);
    }
  });

  it("accepts matching Bearer token", () => {
    process.env.TAILOR_API_KEY = "secret-key";
    const result = authenticateTailorRequest("Bearer secret-key");
    assert.deepEqual(result, { ok: true, mode: "bearer" });
  });

  it("allows insecure bypass only outside production-like deploys", () => {
    process.env.TAILOR_AUTH_INSECURE_BYPASS = "1";
    const result = authenticateTailorRequest(null);
    assert.deepEqual(result, { ok: true, mode: "bypass" });
  });

  it("fails closed when bypass is set with NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.TAILOR_AUTH_INSECURE_BYPASS = "1";
    process.env.TAILOR_API_KEY = "secret-key";
    assert.equal(isProductionLikeDeploy(), true);
    const result = authenticateTailorRequest("Bearer secret-key");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
    }
  });

  it("fails closed when bypass is set with RAILWAY_ENVIRONMENT=production", () => {
    process.env.RAILWAY_ENVIRONMENT = "production";
    process.env.TAILOR_AUTH_INSECURE_BYPASS = "1";
    process.env.TAILOR_API_KEY = "secret-key";
    const result = authenticateTailorRequest("Bearer secret-key");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
    }
  });

  it("fails closed in production when TAILOR_API_KEY is unset", () => {
    process.env.NODE_ENV = "production";
    const result = authenticateTailorRequest("Bearer anything");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
    }
  });

  it("fails closed locally when key is unset and bypass is off", () => {
    const result = authenticateTailorRequest(null);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
    }
  });

  it("ensureSecureStartup is a no-op under NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    process.env.TAILOR_AUTH_INSECURE_BYPASS = "1";
    process.env.RAILWAY_ENVIRONMENT = "production";
    assert.doesNotThrow(() => ensureSecureStartup());
  });

  it("ensureSecureStartup is a no-op in test when production is missing the key", () => {
    process.env.NODE_ENV = "test";
    process.env.RAILWAY_ENVIRONMENT = "production";
    delete process.env.TAILOR_API_KEY;
    assert.doesNotThrow(() => ensureSecureStartup());
  });

  describe("getStartupSecurityError", () => {
    it("fatals in production when TAILOR_API_KEY is unset", () => {
      process.env.NODE_ENV = "production";
      delete process.env.TAILOR_API_KEY;
      const message = getStartupSecurityError();
      assert.equal(typeof message, "string");
      assert.match(message!, /TAILOR_API_KEY/);
      assert.doesNotMatch(message!, /secret-key|Bearer/i);
    });

    it("fatals in production when TAILOR_API_KEY is whitespace-only", () => {
      process.env.NODE_ENV = "production";
      process.env.TAILOR_API_KEY = "   ";
      const message = getStartupSecurityError();
      assert.equal(typeof message, "string");
      assert.match(message!, /TAILOR_API_KEY/);
    });

    it("fatals when VERCEL_ENV=production and the key is unset", () => {
      process.env.VERCEL_ENV = "production";
      delete process.env.TAILOR_API_KEY;
      const message = getStartupSecurityError();
      assert.equal(typeof message, "string");
      assert.match(message!, /TAILOR_API_KEY/);
    });

    it("fatals when RAILWAY_ENVIRONMENT=production and the key is unset", () => {
      process.env.RAILWAY_ENVIRONMENT = "production";
      delete process.env.TAILOR_API_KEY;
      const message = getStartupSecurityError();
      assert.equal(typeof message, "string");
      assert.match(message!, /TAILOR_API_KEY/);
    });

    it("returns undefined in production when the key is set and bypass is off", () => {
      process.env.NODE_ENV = "production";
      process.env.TAILOR_API_KEY = "secret-key";
      assert.equal(getStartupSecurityError(), undefined);
    });

    it("returns the bypass fatal in production even when a key is set", () => {
      process.env.NODE_ENV = "production";
      process.env.TAILOR_API_KEY = "secret-key";
      process.env.TAILOR_AUTH_INSECURE_BYPASS = "1";
      const message = getStartupSecurityError();
      assert.equal(typeof message, "string");
      assert.match(message!, /TAILOR_AUTH_INSECURE_BYPASS/);
    });

    it("returns undefined locally when the key is unset and bypass is off", () => {
      delete process.env.TAILOR_API_KEY;
      assert.equal(isProductionLikeDeploy(), false);
      assert.equal(getStartupSecurityError(), undefined);
      const result = authenticateTailorRequest(null);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 503);
    });
  });

  it("treats VERCEL_ENV=production as a production-like deploy", () => {
    process.env.VERCEL_ENV = "production";
    process.env.TAILOR_AUTH_INSECURE_BYPASS = "1";
    process.env.TAILOR_API_KEY = "secret-key";
    assert.equal(isProductionLikeDeploy(), true);
    const result = authenticateTailorRequest("Bearer secret-key");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  });
});

describe("parseBearerToken", () => {
  it("returns null for a missing header", () => {
    assert.equal(parseBearerToken(null), null);
  });

  it("extracts the token from a Bearer header", () => {
    assert.equal(parseBearerToken("Bearer my-api-key"), "my-api-key");
    assert.equal(parseBearerToken("bearer my-api-key"), "my-api-key");
    assert.equal(parseBearerToken("  Bearer   my-api-key  "), "my-api-key");
  });

  it("rejects non-Bearer schemes and malformed Bearer headers", () => {
    assert.equal(parseBearerToken("Basic dXNlcjpwYXNz"), null);
    assert.equal(parseBearerToken("Bearer"), null);
    assert.equal(parseBearerToken("Bearer token extra"), null);
  });
});

describe("bearerTokenEquals", () => {
  it("accepts equal tokens and rejects different values", () => {
    assert.equal(bearerTokenEquals("same", "same"), true);
    assert.equal(bearerTokenEquals("same", "diff"), false);
  });

  it("rejects tokens with different lengths without leaking via timing", () => {
    assert.equal(bearerTokenEquals("short", "much-longer-token"), false);
  });
});
