import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  probeRedisHelpers,
  readProcessedMark,
  type RedisHelperModule,
} from "../dev/inbox-scan-local";

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
});
