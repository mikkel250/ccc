import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startActiveObservation } from "@langfuse/tracing";
import {
  DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS,
  ensureLangfuseOtel,
  flushLangfuseTraces,
  getLangfuseFlushTimeoutMs,
  __injectLangfuseSpanProcessorForTest,
  __resetLangfuseOtelForTest,
} from "../app/api/lib/langfuse-otel";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readPackageJson(): {
  dependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

function installedVersion(pkgName: string): string {
  const pkg = JSON.parse(
    readFileSync(join(root, "node_modules", pkgName, "package.json"), "utf8")
  ) as { version: string };
  assert.ok(pkg.version, `${pkgName} must declare a version`);
  return pkg.version;
}

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

describe("@opentelemetry/sdk-node pin (protobufjs advisory)", () => {
  it("sets npm legacy-peer-deps so CI can install Langfuse 6 with OTel 0.301", () => {
    const npmrc = readFileSync(join(root, ".npmrc"), "utf8");
    assert.match(
      npmrc,
      /legacy-peer-deps\s*=\s*true/,
      "npm ci must use legacy-peer-deps: Langfuse 6.0.2 peers core 2.x, sdk-node 0.301.2 ships core 3.x"
    );
  });

  it("declares and installs 0.301.x", () => {
    const spec = readPackageJson().dependencies?.["@opentelemetry/sdk-node"];
    assert.ok(spec, "@opentelemetry/sdk-node must be a direct dependency");
    assert.match(
      spec,
      /0\.301/,
      `@opentelemetry/sdk-node must be 0.301.x (got ${spec})`
    );
    const installed = installedVersion("@opentelemetry/sdk-node");
    assert.match(
      installed,
      /^0\.301\./,
      `installed @opentelemetry/sdk-node must be 0.301.x (got ${installed})`
    );
    assert.ok(
      readPackageJson().dependencies?.["@opentelemetry/sdk-trace-base"],
      "@opentelemetry/sdk-trace-base must stay a direct dep: @langfuse/otel imports it and sdk-node 0.301 no longer re-exports it"
    );
  });
});

describe("ensureLangfuseOtel gating", () => {
  beforeEach(() => {
    __resetLangfuseOtelForTest();
    delete process.env.LANGFUSE_TRACING;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
  });

  afterEach(() => {
    __resetLangfuseOtelForTest();
    restoreEnv();
  });

  it("is a no-op when LANGFUSE_TRACING is unset", async () => {
    await ensureLangfuseOtel();
    await flushLangfuseTraces();
  });

  it("is a no-op when LANGFUSE_TRACING is not exactly true", async () => {
    process.env.LANGFUSE_TRACING = "yes";
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    await ensureLangfuseOtel();
    await flushLangfuseTraces();
  });

  it("is a no-op when keys are missing even if tracing is true", async () => {
    process.env.LANGFUSE_TRACING = "true";
    await ensureLangfuseOtel();
    await flushLangfuseTraces();
  });
});

describe("flushLangfuseTraces bound", () => {
  beforeEach(() => {
    __resetLangfuseOtelForTest();
  });

  afterEach(() => {
    __resetLangfuseOtelForTest();
    restoreEnv();
  });

  it("defaults LANGFUSE_FLUSH_TIMEOUT_MS to 5000", () => {
    delete process.env.LANGFUSE_FLUSH_TIMEOUT_MS;
    assert.equal(DEFAULT_LANGFUSE_FLUSH_TIMEOUT_MS, 5000);
    assert.equal(getLangfuseFlushTimeoutMs(), 5000);
  });

  it("returns when no processor is registered", async () => {
    await assert.doesNotReject(() => flushLangfuseTraces());
  });

  it("does not hang when forceFlush never resolves", { timeout: 500 }, async () => {
    process.env.LANGFUSE_FLUSH_TIMEOUT_MS = "30";
    __injectLangfuseSpanProcessorForTest({
      forceFlush: () => new Promise(() => {}),
    });
    const started = Date.now();
    await flushLangfuseTraces();
    assert.ok(Date.now() - started < 400);
  });
});

describe("ensureLangfuseOtel 0.301 start", () => {
  afterEach(() => {
    __resetLangfuseOtelForTest();
    restoreEnv();
  });

  it("starts NodeSDK and POSTs a generation to LANGFUSE_BASE_URL", { timeout: 15000 }, async () => {
    const posts: string[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        posts.push(`${req.method ?? ""} ${req.url ?? ""}`);
        res.statusCode = 200;
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    process.env.LANGFUSE_TRACING = "true";
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_BASE_URL = baseUrl;
    __resetLangfuseOtelForTest();

    try {
      await ensureLangfuseOtel();
      await startActiveObservation(
        "otel-upgrade-probe",
        async (generation) => {
          generation.update({ output: "ok" });
        },
        { asType: "generation" }
      );
      await flushLangfuseTraces();
      assert.ok(
        posts.some((entry) => entry.includes("/api/public/otel/v1/traces")),
        `expected OTLP export to mock collector, got: ${posts.join(" | ") || "(none)"}`
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
