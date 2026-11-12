import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateReadiness } from "../app/api/lib/readiness";
import { __resetMasterCvCacheForTest, loadMasterCv } from "../app/api/lib/master-cv";
import { GET } from "../app/api/ready/route";

const ORIGINAL_ENV = { ...process.env };
const FIXTURE_CV = readFileSync(
  join(process.cwd(), "tests/fixtures/curated-cv-valid.json"),
  "utf8"
);

function resetReadinessEnv() {
  delete process.env.TAILOR_API_KEY;
  delete process.env.TAILOR_AUTH_INSECURE_BYPASS;
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.VERCEL_ENV;
  delete process.env.MASTER_CV_JSON;
  delete process.env.MASTER_CV_PATH;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.NODE_ENV = "test";
  __resetMasterCvCacheForTest();
}

function configureReadyEnv() {
  process.env.TAILOR_API_KEY = "ready-test-key";
  process.env.MASTER_CV_JSON = FIXTURE_CV;
  process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "example-token";
  loadMasterCv();
}

describe("evaluateReadiness", () => {
  beforeEach(() => {
    resetReadinessEnv();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __resetMasterCvCacheForTest();
  });

  it("is not ready when auth, master CV, and Redis are all unset", async () => {
    const result = await evaluateReadiness();
    assert.equal(result.ok, false);
    assert.deepEqual(result.checks, {
      auth: "failed",
      masterCv: "failed",
      redis: "failed",
    });
  });

  it("treats a configured API key with no Bearer as auth-ready", async () => {
    process.env.TAILOR_API_KEY = "ready-test-key";
    const result = await evaluateReadiness();
    assert.equal(result.checks.auth, "ok");
    assert.equal(result.ok, false);
  });

  it("treats local insecure bypass as auth-ready", async () => {
    process.env.TAILOR_AUTH_INSECURE_BYPASS = "1";
    const result = await evaluateReadiness();
    assert.equal(result.checks.auth, "ok");
  });

  it("fails auth in a production-like deploy with no API key", async () => {
    process.env.RAILWAY_ENVIRONMENT = "production";
    const result = await evaluateReadiness();
    assert.equal(result.checks.auth, "failed");
    assert.equal(result.ok, false);
  });

  it("fails auth when insecure bypass is set in a production-like deploy", async () => {
    process.env.RAILWAY_ENVIRONMENT = "production";
    process.env.TAILOR_AUTH_INSECURE_BYPASS = "1";
    process.env.TAILOR_API_KEY = "ready-test-key";
    const result = await evaluateReadiness();
    assert.equal(result.checks.auth, "failed");
  });

  it("loads master CV on demand when the preload cache is empty", async () => {
    process.env.TAILOR_API_KEY = "ready-test-key";
    process.env.MASTER_CV_JSON = FIXTURE_CV;
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "example-token";
    const result = await evaluateReadiness();
    assert.equal(result.checks.masterCv, "ok");
    assert.equal(result.ok, true);
  });

  it("fails masterCv when preload cached a load failure", async () => {
    process.env.TAILOR_API_KEY = "ready-test-key";
    loadMasterCv();
    const result = await evaluateReadiness();
    assert.equal(result.checks.masterCv, "failed");
  });

  it("passes masterCv after a successful preload", async () => {
    process.env.MASTER_CV_JSON = FIXTURE_CV;
    loadMasterCv();
    const result = await evaluateReadiness();
    assert.equal(result.checks.masterCv, "ok");
  });

  it("fails redis when URL or token is missing", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.upstash.io";
    assert.equal((await evaluateReadiness()).checks.redis, "failed");
    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = "example-token";
    assert.equal((await evaluateReadiness()).checks.redis, "failed");
  });

  it("fails redis when URL or token is blank", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "   ";
    process.env.UPSTASH_REDIS_REST_TOKEN = "example-token";
    assert.equal((await evaluateReadiness()).checks.redis, "failed");
  });

  it("is ready when auth, preloaded master CV, and Redis env are present", async () => {
    configureReadyEnv();
    const result = await evaluateReadiness();
    assert.deepEqual(result, {
      ok: true,
      checks: { auth: "ok", masterCv: "ok", redis: "ok" },
    });
  });
});

describe("GET /api/ready", () => {
  beforeEach(() => {
    resetReadinessEnv();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __resetMasterCvCacheForTest();
  });

  it("returns 200 with status ok and no-store when ready", async () => {
    configureReadyEnv();
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body: unknown = await response.json();
    assert.deepEqual(body, {
      service: "cv-tailoring-api",
      status: "ok",
      checks: { auth: "ok", masterCv: "ok", redis: "ok" },
    });
  });

  it("returns 503 with status not_ready when a check fails", async () => {
    const response = await GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = (await response.json()) as {
      service: string;
      status: string;
      checks: { auth: string; masterCv: string; redis: string };
    };
    assert.equal(body.service, "cv-tailoring-api");
    assert.equal(body.status, "not_ready");
    assert.equal(body.checks.auth, "failed");
    assert.equal(body.checks.masterCv, "failed");
    assert.equal(body.checks.redis, "failed");
    assert.equal(JSON.stringify(body).includes("ready-test-key"), false);
  });

  it("does not require Authorization", async () => {
    configureReadyEnv();
    const response = await GET();
    assert.equal(response.status, 200);
  });
});

describe("Railway API healthcheck", () => {
  it("probes GET /api/ready instead of process-up /api/hello", () => {
    const toml = readFileSync(join(process.cwd(), "railway.toml"), "utf8");
    const uncommented = toml
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    assert.match(uncommented, /healthcheckPath\s*=\s*"\/api\/ready"/);
    assert.equal(/healthcheckPath\s*=\s*"\/api\/hello"/.test(uncommented), false);
  });
});
