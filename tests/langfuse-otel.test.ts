import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS,
  flushLangfuseTraces,
  getLangfuseFlushTimeoutMs,
} from "../app/api/lib/langfuse-otel";

const ORIGINAL_ENV = { ...process.env };
const key = "LANGFUSE_FLUSH_TIMEOUT_MS";

describe("getLangfuseFlushTimeoutMs", () => {
  beforeEach(() => {
    delete process.env[key];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS when unset", () => {
    assert.equal(getLangfuseFlushTimeoutMs(), DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS);
  });

  it("reads a positive LANGFUSE_FLUSH_TIMEOUT_MS override", () => {
    process.env[key] = "12000";
    assert.equal(getLangfuseFlushTimeoutMs(), 12000);
  });

  it("floors zero and negative values to 1ms", () => {
    process.env[key] = "0";
    assert.equal(getLangfuseFlushTimeoutMs(), 1);
    process.env[key] = "-5";
    assert.equal(getLangfuseFlushTimeoutMs(), 1);
  });
});

describe("LANGFUSE_FLUSH_TIMEOUT_MS catalog", () => {
  it(".env.example documents LANGFUSE_FLUSH_TIMEOUT_MS matching DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS", () => {
    const content = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const match = content.match(/^\s*LANGFUSE_FLUSH_TIMEOUT_MS=(\d+)\s*$/m);
    assert.ok(match, "LANGFUSE_FLUSH_TIMEOUT_MS must appear in .env.example");
    assert.equal(Number(match[1]), DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS);
  });
});

describe("flushLangfuseTraces", () => {
  it("resolves immediately when Langfuse OTEL was never started", async () => {
    await assert.doesNotReject(() => flushLangfuseTraces());
  });
});