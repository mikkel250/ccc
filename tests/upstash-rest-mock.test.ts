import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { __inboxRedisScriptsForTest } from "../app/api/lib/inbox-processed-store";
import {
  createMemoryStore,
  createUpstashRestMock,
  DEFAULT_UPSTASH_REST_TOKEN,
  evalLua,
  runCommand,
  slidingWindowEval,
} from "../dev/upstash-rest-mock.mjs";

const LIMIT_SCRIPT = `
  local requestsInCurrentWindow = redis.call("GET", currentKey)
  redis.call("INCRBY", currentKey, incrementBy)
`;
const REMAINING_SCRIPT = `
  local requestsInCurrentWindow = redis.call("GET", currentKey)
`;

describe("upstash-rest-mock sliding window", () => {
  it("returns [remaining, limit] and -1 after the token budget is spent", () => {
    const memory = createMemoryStore();
    const keys = ["cur", "prev", ""];
    const now = Date.now();
    const windowMs = 60_000;
    const tokens = 2;
    const first = slidingWindowEval(memory, keys, [tokens, now, windowMs, 1], true);
    const second = slidingWindowEval(memory, keys, [tokens, now, windowMs, 1], true);
    const denied = slidingWindowEval(memory, keys, [tokens, now, windowMs, 1], true);
    assert.deepEqual(first, [1, 2]);
    assert.deepEqual(second, [0, 2]);
    assert.deepEqual(denied, [-1, 2]);
  });

  it("EVALSHA is NOSCRIPT so the SDK can fall back to EVAL", () => {
    const memory = createMemoryStore();
    assert.throws(
      () => runCommand(memory, ["EVALSHA", "deadbeef", 1, "k"]),
      /NOSCRIPT/
    );
  });

  it("EVAL of a GET script returns the stored string", () => {
    const memory = createMemoryStore();
    runCommand(memory, ["SET", "inbox:processed:m1", "1"]);
    assert.equal(
      evalLua(memory, 'return redis.call("GET", KEYS[1])', ["inbox:processed:m1"], []),
      "1"
    );
  });

  it("EVAL of the sliding-window script uses INCRBY vs remaining shapes", () => {
    const memory = createMemoryStore();
    const now = Date.now();
    const allowed = evalLua(
      memory,
      LIMIT_SCRIPT,
      ["cur", "prev", ""],
      ["1", String(now), "60000", "1"]
    );
    assert.deepEqual(allowed, [0, 1]);
    const remaining = evalLua(
      memory,
      REMAINING_SCRIPT,
      ["cur", "prev", ""],
      ["1", String(now), "60000"]
    );
    assert.deepEqual(remaining, [0, 1]);
  });
});

describe("upstash-rest-mock inbox scripts", () => {
  it("matches production claim completion, renewal, and release", () => {
    const scripts = __inboxRedisScriptsForTest();
    const memory = createMemoryStore();

    runCommand(memory, ["SET", "claim", "token-a"]);
    assert.equal(
      evalLua(memory, scripts.markProcessedIfOwned, ["claim", "processed"], ["other", "0"]),
      0
    );
    assert.equal(runCommand(memory, ["GET", "claim"]), "token-a");
    assert.equal(runCommand(memory, ["GET", "processed"]), null);
    assert.equal(
      evalLua(memory, scripts.markProcessedIfOwned, ["claim", "processed"], ["token-a", "0"]),
      1
    );
    assert.equal(runCommand(memory, ["GET", "claim"]), null);
    assert.equal(runCommand(memory, ["GET", "processed"]), "1");
    assert.equal(runCommand(memory, ["TTL", "processed"]), -1);

    runCommand(memory, ["SET", "renew", "token-a"]);
    assert.equal(runCommand(memory, ["TTL", "renew"]), -1);
    assert.equal(
      evalLua(memory, scripts.expireIfOwned, ["renew"], ["other", "30"]),
      0
    );
    assert.equal(runCommand(memory, ["GET", "renew"]), "token-a");
    assert.equal(runCommand(memory, ["TTL", "renew"]), -1);
    assert.equal(
      evalLua(memory, scripts.expireIfOwned, ["renew"], ["token-a", "30"]),
      1
    );
    assert.equal(runCommand(memory, ["GET", "renew"]), "token-a");
    assert.ok(Number(runCommand(memory, ["TTL", "renew"])) > 0);

    assert.equal(evalLua(memory, scripts.deleteIfValue, ["renew"], ["other"]), 0);
    assert.equal(runCommand(memory, ["GET", "renew"]), "token-a");
    assert.equal(evalLua(memory, scripts.deleteIfValue, ["renew"], ["token-a"]), 1);
    assert.equal(runCommand(memory, ["GET", "renew"]), null);
  });
});

type MockHandle = ReturnType<typeof createUpstashRestMock>["handle"];

async function callHandle(
  handle: MockHandle,
  init: {
    url?: string;
    authorization?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }
): Promise<{ status: number; body: unknown }> {
  const raw = init.body === undefined ? "" : JSON.stringify(init.body);
  const req = Object.assign(
    (async function* () {
      if (raw) yield Buffer.from(raw);
    })(),
    {
      method: "POST",
      url: init.url ?? "/",
      headers: { authorization: init.authorization, ...init.headers },
    }
  );
  let status = 0;
  let payload = "";
  await handle(req, {
    writeHead(code: number) {
      status = code;
    },
    end(body: string) {
      payload = body;
    },
  });
  const body: unknown = payload ? JSON.parse(payload) : null;
  return { status, body };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("createUpstashRestMock handle", () => {
  it("returns raw Redis strings unless Upstash-Encoding is base64", async () => {
    const mock = createUpstashRestMock({ token: "tok" });
    mock.runCommand(["SET", "inbox:processed:m1", "1"]);
    mock.runCommand(["SET", "name", "Ada"]);

    const pipeline = await callHandle(mock.handle, {
      url: "/pipeline",
      authorization: "Bearer tok",
      body: [["PING"], ["GET", "inbox:processed:m1"], ["INCR", "n"]],
    });
    assert.equal(pipeline.status, 200);
    assert.deepEqual(pipeline.body, [
      { result: "PONG" },
      { result: "1" },
      { result: 1 },
    ]);

    const raw = await callHandle(mock.handle, {
      authorization: "Bearer tok",
      body: ["GET", "name"],
    });
    assert.equal(raw.status, 200);
    assert.deepEqual(raw.body, { result: "Ada" });

    const encoded = await callHandle(mock.handle, {
      authorization: "Bearer tok",
      headers: { "Upstash-Encoding": "base64" },
      body: ["GET", "inbox:processed:m1"],
    });
    assert.equal(encoded.status, 200);
    assert.deepEqual(encoded.body, {
      result: Buffer.from("1", "utf8").toString("base64"),
    });
  });

  it("returns HTTP 401 when authorization is missing or invalid", async () => {
    const mock = createUpstashRestMock({ token: "tok" });
    const missing = await callHandle(mock.handle, { body: ["PING"] });
    const invalid = await callHandle(mock.handle, {
      authorization: "Bearer wrong",
      body: ["PING"],
    });
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.body, { error: "Unauthorized" });
    assert.equal(invalid.status, 401);
    assert.deepEqual(invalid.body, { error: "Unauthorized" });
  });

  it("resolves the bearer token from options, UPSTASH_REST_TOKEN, then UPSTASH_REDIS_REST_TOKEN", async () => {
    const savedRest = process.env.UPSTASH_REST_TOKEN;
    const savedRedis = process.env.UPSTASH_REDIS_REST_TOKEN;
    try {
      process.env.UPSTASH_REST_TOKEN = "rest-token";
      process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
      const fromOption = createUpstashRestMock({ token: "opt-token" });
      assert.equal(
        (await callHandle(fromOption.handle, { authorization: "Bearer opt-token", body: ["PING"] })).status,
        200
      );
      assert.equal(
        (await callHandle(fromOption.handle, { authorization: "Bearer rest-token", body: ["PING"] })).status,
        401
      );

      const fromRest = createUpstashRestMock();
      assert.equal(
        (await callHandle(fromRest.handle, { authorization: "Bearer rest-token", body: ["PING"] })).status,
        200
      );
      assert.equal(
        (await callHandle(fromRest.handle, { authorization: "Bearer redis-token", body: ["PING"] })).status,
        401
      );

      delete process.env.UPSTASH_REST_TOKEN;
      const fromRedis = createUpstashRestMock();
      assert.equal(
        (await callHandle(fromRedis.handle, { authorization: "Bearer redis-token", body: ["PING"] })).status,
        200
      );
      assert.equal(
        (await callHandle(fromRedis.handle, { authorization: `Bearer ${DEFAULT_UPSTASH_REST_TOKEN}`, body: ["PING"] })).status,
        401
      );

      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      const fromDefault = createUpstashRestMock();
      assert.equal(
        (
          await callHandle(fromDefault.handle, {
            authorization: `Bearer ${DEFAULT_UPSTASH_REST_TOKEN}`,
            body: ["PING"],
          })
        ).status,
        200
      );
    } finally {
      restoreEnv("UPSTASH_REST_TOKEN", savedRest);
      restoreEnv("UPSTASH_REDIS_REST_TOKEN", savedRedis);
    }
  });
});
