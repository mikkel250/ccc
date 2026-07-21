import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateTailorRequest,
  isProductionLikeDeploy,
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
});
