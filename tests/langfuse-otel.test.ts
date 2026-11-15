import { describe, it, beforeEach, afterEach, mock } from "node:test";
import type { LangfuseSpanProcessor as LangfuseSpanProcessorType } from "@langfuse/otel";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS,
  flushLangfuseTraces,
  getLangfuseFlushTimeoutMs,
  resetLangfuseOtelForTests,
  setLangfuseSpanProcessorForTests,
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
  const savedFlushTimeout = ORIGINAL_ENV.LANGFUSE_FLUSH_TIMEOUT_MS;

  afterEach(() => {
    resetLangfuseOtelForTests();
    mock.restoreAll();
    if (savedFlushTimeout === undefined) delete process.env[key];
    else process.env[key] = savedFlushTimeout;
  });

  function captureWarnings(): { warnings: unknown[][]; restore: () => void } {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    return {
      warnings,
      restore: () => {
        console.warn = originalWarn;
      },
    };
  }

  function stubProcessor(
    forceFlush: () => Promise<void>
  ): LangfuseSpanProcessorType {
    return { forceFlush } as LangfuseSpanProcessorType;
  }

  it("resolves immediately when Langfuse OTEL was never started", async () => {
    const forceFlush = mock.method(
      LangfuseSpanProcessor.prototype,
      "forceFlush",
      async () => {
        throw new Error("forceFlush must not run when Langfuse OTEL was never started");
      }
    );
    const { warnings, restore } = captureWarnings();
    try {
      const pending = flushLangfuseTraces();
      assert.equal(forceFlush.mock.callCount(), 0);
      await assert.doesNotReject(() => pending);
      assert.equal(forceFlush.mock.callCount(), 0);
      assert.equal(warnings.length, 0);
    } finally {
      restore();
    }
  });

  it(
    "warns and resolves when forceFlush hangs past LANGFUSE_FLUSH_TIMEOUT_MS",
    { timeout: 500 },
    async () => {
      process.env[key] = "1";
      let flushCalls = 0;
      setLangfuseSpanProcessorForTests(
        stubProcessor(async () => {
          flushCalls += 1;
          await new Promise<void>(() => {});
        })
      );
      const { warnings, restore } = captureWarnings();
      try {
        const started = Date.now();
        await assert.doesNotReject(() => flushLangfuseTraces());
        assert.ok(Date.now() - started < 200);
        assert.equal(flushCalls, 1);
        assert.equal(warnings.length, 1);
        assert.match(String(warnings[0]?.[0]), /Langfuse flush failed or timed out/i);
        const reason = warnings[0]?.[1];
        assert.ok(reason instanceof Error);
        assert.match(reason.message, /timed out after 1ms/i);
      } finally {
        restore();
      }
    }
  );

  it("warns and resolves when forceFlush rejects", async () => {
    process.env[key] = "5000";
    const exportError = new Error("langfuse export rejected");
    let flushCalls = 0;
    setLangfuseSpanProcessorForTests(
      stubProcessor(async () => {
        flushCalls += 1;
        throw exportError;
      })
    );
    const { warnings, restore } = captureWarnings();
    try {
      await assert.doesNotReject(() => flushLangfuseTraces());
      assert.equal(flushCalls, 1);
      assert.equal(warnings.length, 1);
      assert.match(String(warnings[0]?.[0]), /Langfuse flush failed or timed out/i);
      assert.equal(warnings[0]?.[1], exportError);
    } finally {
      restore();
    }
  });
});