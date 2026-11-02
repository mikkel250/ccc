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
    "DEEPSEEK_BASE_URL",
    "MASTER_CV_JSON",
    "TAILOR_MODEL",
  ] as const;

  beforeEach(() => {
    __resetMasterCvCacheForTest();
    for (const key of keys) {
      saved[key] = process.env[key];
    }
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
