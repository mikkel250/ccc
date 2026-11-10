import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __resetMasterCvCacheForTest } from "../app/api/lib/master-cv";
import {
  probeRedisHelpers,
  readProcessedMark,
  runLocalInboxCli,
  runLocalInboxScan,
  type RedisHelperModule,
} from "../dev/inbox-scan-local";

const validCv = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/curated-cv-valid.json"), "utf8")
) as unknown;

function createFakeRedis(store: Map<string, string>): RedisHelperModule {
  const client = {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK" as const;
    },
    eval: async (_script: string, keys: string[]) => store.get(keys[0] ?? "") ?? null,
  };
  return {
    getRedisClient: () => client,
    getRedisKey: async (c, key) => c.get(key),
    setRedisKey: async (c, key, value) => c.set(key, value),
    evalRedisScript: async (c, _script, key) => c.eval("", [key], []),
  };
}

describe("runLocalInboxScan service URLs", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "DEEPSEEK_BASE_URL",
    "DEEPSEEK_API_KEY",
    "MASTER_CV_JSON",
    "TAILOR_MODEL",
    "UPSTASH_REST_PORT",
    "DEEPSEEK_MOCK_PORT",
    "INBOX_SCAN_LOCAL_REDIS_PROBE",
  ] as const;

  beforeEach(() => {
    __resetMasterCvCacheForTest();
    for (const key of keys) {
      saved[key] = process.env[key];
    }
    delete process.env.INBOX_SCAN_LOCAL_REDIS_PROBE;
  });

  afterEach(() => {
    __resetMasterCvCacheForTest();
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("throws before scan when Redis or DeepSeek is not loopback", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.DEEPSEEK_BASE_URL = "http://127.0.0.1:4010";
    process.env.TAILOR_MODEL = "deepseek/deepseek-chat";
    let scanned = false;
    await assert.rejects(
      () =>
        runLocalInboxScan({
          scan: async () => {
            scanned = true;
            return { ok: true, items: [] };
          },
          redisMod: createFakeRedis(new Map()),
        }),
      /UPSTASH_REDIS_REST_URL/
    );
    assert.equal(scanned, false);
    assert.equal(process.env.UPSTASH_REDIS_REST_URL, "https://example.upstash.io");
  });

  it("fills blank Redis and model settings before the loopback check", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.TAILOR_MODEL;
    delete process.env.UPSTASH_REST_PORT;
    delete process.env.DEEPSEEK_MOCK_PORT;
    delete process.env.INBOX_SCAN_LOCAL_REDIS_PROBE;
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    const store = new Map<string, string>();
    let scanned = false;
    const outcome = await runLocalInboxScan({
      scan: async () => {
        scanned = true;
        return { ok: true, items: [] };
      },
      redisMod: createFakeRedis(store),
    });
    assert.equal(scanned, true);
    assert.equal(outcome.ok, true);
    assert.equal(process.env.UPSTASH_REDIS_REST_URL, "http://127.0.0.1:8079");
    assert.equal(process.env.UPSTASH_REDIS_REST_TOKEN, "local-dev-upstash-token");
    assert.equal(process.env.DEEPSEEK_BASE_URL, "http://127.0.0.1:4010");
    assert.equal(process.env.DEEPSEEK_API_KEY, "local-dev-deepseek-key");
    assert.equal(process.env.TAILOR_MODEL, "deepseek/deepseek-chat");
    assert.equal(store.has("inbox:local-dev-probe"), false);
    assert.equal(outcome.redisProbe, null);
  });

  it("uses the configured mock ports when filling blank client URLs", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.TAILOR_MODEL;
    process.env.UPSTASH_REST_PORT = "18079";
    process.env.DEEPSEEK_MOCK_PORT = "14010";
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    await runLocalInboxScan({
      scan: async () => ({ ok: true, items: [] }),
      redisMod: createFakeRedis(new Map()),
    });
    assert.equal(process.env.UPSTASH_REDIS_REST_URL, "http://127.0.0.1:18079");
    assert.equal(process.env.DEEPSEEK_BASE_URL, "http://127.0.0.1:14010");
  });

  it("keeps an explicit non-deepseek model after filling blank URLs", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.DEEPSEEK_BASE_URL;
    process.env.TAILOR_MODEL = "anthropic/sonnet";
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    await assert.rejects(
      () =>
        runLocalInboxScan({
          scan: async () => ({ ok: true, items: [] }),
          redisMod: createFakeRedis(new Map()),
        }),
      /TAILOR_MODEL/
    );
    assert.equal(process.env.TAILOR_MODEL, "anthropic/sonnet");
  });

  it("writes the Redis probe only when INBOX_SCAN_LOCAL_REDIS_PROBE is set", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:8079";
    process.env.DEEPSEEK_BASE_URL = "http://127.0.0.1:4010";
    process.env.TAILOR_MODEL = "deepseek/deepseek-chat";
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    process.env.INBOX_SCAN_LOCAL_REDIS_PROBE = "1";
    const store = new Map<string, string>();
    const outcome = await runLocalInboxScan({
      scan: async () => ({ ok: false, error: "scan broke" }),
      redisMod: createFakeRedis(store),
    });
    assert.deepEqual(outcome.scan, { ok: false, error: "scan broke" });
    assert.equal(store.get("inbox:local-dev-probe"), "ok");
    assert.equal(outcome.redisProbe?.get, "ok");
  });

  it("returns the scan result when the opted-in probe throws", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:8079";
    process.env.DEEPSEEK_BASE_URL = "http://127.0.0.1:4010";
    process.env.TAILOR_MODEL = "deepseek/deepseek-chat";
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    process.env.INBOX_SCAN_LOCAL_REDIS_PROBE = "1";
    const full = createFakeRedis(new Map());
    const outcome = await runLocalInboxScan({
      scan: async () => ({ ok: false, error: "scan broke" }),
      redisMod: {
        getRedisClient: full.getRedisClient,
        getRedisKey: full.getRedisKey,
        setRedisKey: async () => {
          throw new Error("redis down");
        },
        evalRedisScript: full.evalRedisScript,
      },
    });
    assert.equal(outcome.ok, false);
    assert.deepEqual(outcome.scan, { ok: false, error: "scan broke" });
    assert.equal(outcome.redisProbe?.error, "redis down");
  });

  it("exits 1 when the scan is ok but an item failed", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:8079";
    process.env.DEEPSEEK_BASE_URL = "http://127.0.0.1:4010";
    process.env.TAILOR_MODEL = "deepseek/deepseek-chat";
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    const outcome = await runLocalInboxCli({
      scan: async () => ({
        ok: true,
        items: [{ messageId: "m1", status: "tailor-failed" }],
      }),
      redisMod: createFakeRedis(new Map()),
    });
    assert.equal(outcome.exitCode, 1);
  });
});

describe("probeRedisHelpers", () => {
  it("uses get/set/eval helpers when they exist", async () => {
    const store = new Map<string, string>();
    const result = await probeRedisHelpers(createFakeRedis(store), "inbox:local-dev-probe");
    assert.equal(result.usedHelpers, true);
    assert.equal(result.get, "ok");
    assert.equal(result.eval, "ok");
    assert.equal(store.get("inbox:local-dev-probe"), "ok");
  });

  it("falls back when Command-class helpers throw", async () => {
    const store = new Map<string, string>();
    const full = createFakeRedis(store);
    const result = await probeRedisHelpers(
      {
        getRedisClient: full.getRedisClient,
        getRedisKey: async () => {
          throw new Error("GetCommand is not a constructor");
        },
        setRedisKey: async () => {
          throw new Error("SetCommand is not a constructor");
        },
        evalRedisScript: async () => {
          throw new Error("EvalCommand is not a constructor");
        },
      },
      "inbox:local-dev-probe"
    );
    assert.equal(result.usedHelpers, false);
    assert.equal(result.get, "ok");
  });

  it("falls back to Redis client methods when helpers are absent", async () => {
    const store = new Map<string, string>();
    const full = createFakeRedis(store);
    const result = await probeRedisHelpers(
      { getRedisClient: full.getRedisClient },
      "inbox:local-dev-probe"
    );
    assert.equal(result.usedHelpers, false);
    assert.equal(result.get, "ok");
    assert.equal(result.eval, "ok");
  });

  it("rethrows helper errors other than a missing Command constructor", async () => {
    const store = new Map<string, string>();
    const full = createFakeRedis(store);
    await assert.rejects(
      () =>
        probeRedisHelpers(
          {
            getRedisClient: full.getRedisClient,
            getRedisKey: full.getRedisKey,
            setRedisKey: async () => {
              throw new Error("redis down");
            },
            evalRedisScript: full.evalRedisScript,
          },
          "inbox:local-dev-probe"
        ),
      /redis down/
    );
    assert.equal(store.has("inbox:local-dev-probe"), false);
  });
});

describe("readProcessedMark", () => {
  it("reads the inbox processed key through getRedisKey when present", async () => {
    const store = new Map<string, string>([["inbox:processed:m1", "1"]]);
    const value = await readProcessedMark(createFakeRedis(store), "m1");
    assert.equal(value, "1");
  });

  it("falls back to client.get when getRedisKey throws", async () => {
    const store = new Map<string, string>([["inbox:processed:m1", "1"]]);
    const full = createFakeRedis(store);
    const value = await readProcessedMark(
      {
        getRedisClient: full.getRedisClient,
        getRedisKey: async () => {
          throw new Error("GetCommand is not a constructor");
        },
      },
      "m1"
    );
    assert.equal(value, "1");
  });

  it("rethrows getRedisKey errors other than a missing Command constructor", async () => {
    const store = new Map<string, string>([["inbox:processed:m1", "1"]]);
    const full = createFakeRedis(store);
    await assert.rejects(
      () =>
        readProcessedMark(
          {
            getRedisClient: full.getRedisClient,
            getRedisKey: async () => {
              throw new Error("redis down");
            },
          },
          "m1"
        ),
      /redis down/
    );
  });
});
