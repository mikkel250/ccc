import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getRateLimitConfig } from "../app/api/lib/rate-limit";
import {
  evalRedisScript,
  getRedisClient,
  getRedisKey,
  resetRedisClientForTest,
  setRedisKey,
} from "../app/api/lib/redis";
import { getEnvNumber } from "../lib/env";

describe("getRedisClient", () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  afterEach(() => {
    resetRedisClientForTest();
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  });

  it("throws when UPSTASH_REDIS_REST_URL is missing", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    assert.throws(() => getRedisClient(), /UPSTASH_REDIS_REST_URL/i);
  });

  it("throws when UPSTASH_REDIS_REST_TOKEN is missing", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    assert.throws(() => getRedisClient(), /UPSTASH_REDIS_REST_TOKEN/i);
  });

  it("returns a Redis client when env vars are set", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    const client = getRedisClient();
    assert.equal(typeof client, "object");
    assert.notEqual(client, null);
  });

  it("returns the same singleton instance on subsequent calls", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    const first = getRedisClient();
    const second = getRedisClient();
    assert.equal(first, second);
  });

  it("resetRedisClientForTest throws outside test environment", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.throws(
        () => resetRedisClientForTest(),
        /only available in the test environment/i
      );
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });
});

describe("Upstash rate limit runtime config", () => {
  it("getRateLimitConfig timeoutMs matches the Upstash SDK timeout wired in rate-limit.ts", () => {
    const expectedTimeoutMs = Math.max(
      1,
      Math.floor(getEnvNumber("RATE_LIMIT_TIMEOUT_MS", 2000))
    );
    assert.equal(getRateLimitConfig().timeoutMs, expectedTimeoutMs);
  });
});

describe("redis command helpers", () => {
  it("getRedisKey reads via client.get", async () => {
    const got: string[] = [];
    const client = {
      get: async (key: string) => {
        got.push(key);
        return "cached";
      },
    };
    assert.equal(await getRedisKey(client, "inbox:processed:abc"), "cached");
    assert.deepEqual(got, ["inbox:processed:abc"]);
  });

  it("setRedisKey writes via client.set including SET options", async () => {
    const calls: Array<{
      key: string;
      value: string;
      opts: unknown;
    }> = [];
    const client = {
      set: async (key: string, value: string, opts?: { nx?: boolean; ex?: number }) => {
        calls.push({ key, value, opts });
        return "OK";
      },
    };
    assert.equal(
      await setRedisKey(client, "inbox:claim:abc", "token", { nx: true, ex: 900 }),
      "OK"
    );
    assert.deepEqual(calls, [
      { key: "inbox:claim:abc", value: "token", opts: { nx: true, ex: 900 } },
    ]);
  });

  it("evalRedisScript runs client.eval with the script, key, and args", async () => {
    const calls: Array<{ script: string; keys: string[]; args: string[] }> = [];
    const client = {
      eval: async (script: string, keys: string[], args: string[]) => {
        calls.push({ script, keys, args });
        return 1;
      },
    };
    const script = 'if redis.call("get", KEYS[1]) == ARGV[1] then return 1 else return 0 end';
    assert.equal(await evalRedisScript(client, script, "inbox:claim:abc", ["token"]), 1);
    assert.deepEqual(calls, [
      { script, keys: ["inbox:claim:abc"], args: ["token"] },
    ]);
  });
});

function encodeUpstashResult(result: unknown): unknown {
  if (result === "OK" || result === null || typeof result === "number") {
    return result;
  }
  if (typeof result === "string") {
    return Buffer.from(result, "utf8").toString("base64");
  }
  if (Array.isArray(result)) {
    return result.map(encodeUpstashResult);
  }
  return result;
}

function runUpstashCommand(store: Map<string, string>, command: unknown[]): unknown {
  const op = String(command[0] ?? "").toUpperCase();
  if (op === "SET") {
    store.set(String(command[1]), String(command[2]));
    return "OK";
  }
  if (op === "GET") {
    return store.get(String(command[1])) ?? null;
  }
  if (op === "EVAL") {
    const numKeys = Number(command[2]);
    const keys = command.slice(3, 3 + numKeys).map(String);
    return store.get(keys[0] ?? "") ?? null;
  }
  throw new Error(`unsupported command ${op}`);
}

describe("redis helpers through the Upstash REST client", () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  let server: http.Server | undefined;

  afterEach(async () => {
    resetRedisClientForTest();
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = undefined;
    }
  });

  it("get/set/eval round-trip via the public Redis client", async () => {
    const store = new Map<string, string>();
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "[]") as unknown;
        const path = req.url ?? "/";
        const isPipeline =
          path.includes("pipeline") || (Array.isArray(parsed) && Array.isArray(parsed[0]));
        try {
          if (isPipeline && Array.isArray(parsed)) {
            const results = parsed.map((cmd) => ({
              result: encodeUpstashResult(runUpstashCommand(store, cmd as unknown[])),
            }));
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(results));
            return;
          }
          const result = encodeUpstashResult(
            runUpstashCommand(store, parsed as unknown[])
          );
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ result }));
        } catch (error) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            })
          );
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${address.port}`;
    process.env.UPSTASH_REDIS_REST_TOKEN = "probe-token";
    resetRedisClientForTest();

    const client = getRedisClient();
    const key = "ccc:helper-probe";
    assert.equal(await setRedisKey(client, key, "ok", { ex: 60 }), "OK");
    assert.equal(await getRedisKey(client, key), "ok");
    assert.equal(
      await evalRedisScript(client, 'return redis.call("GET", KEYS[1])', key, []),
      "ok"
    );
  });
});
