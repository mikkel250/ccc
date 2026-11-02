import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __inboxRedisScriptsForTest } from "../app/api/lib/inbox-processed-store";

// `npm test` sets this via tests/set-node-env-test.mjs. Plain `node --test` does not.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}
import {
  createMemoryStore,
  createUpstashRestMock,
  DEFAULT_UPSTASH_REST_TOKEN,
  evalLua,
  runCommand,
  slidingWindowEval,
} from "../dev/upstash-rest-mock.mjs";

const SLIDING_LIMIT_SCRIPT = `
  local current = redis.call("GET", currentKey)
  local previous = redis.call("GET", previousKey)
  local percentageInCurrent = ( now % window ) / window
  redis.call("INCRBY", currentKey, incrementBy)
  redis.call("PEXPIRE", currentKey, window)
`;
const SLIDING_REMAINING_SCRIPT = `
  local current = redis.call("GET", currentKey)
  local previous = redis.call("GET", previousKey)
  local percentageInCurrent = ( now % window ) / window
`;
const NAME_ONLY_SCRIPT = `
  local requestsInCurrentWindow = redis.call("GET", currentKey)
  redis.call("INCRBY", currentKey, incrementBy)
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
      SLIDING_LIMIT_SCRIPT,
      ["cur", "prev", ""],
      ["1", String(now), "60000", "1"]
    );
    assert.deepEqual(allowed, [0, 1]);
    const remaining = evalLua(
      memory,
      SLIDING_REMAINING_SCRIPT,
      ["cur", "prev", ""],
      ["1", String(now), "60000"]
    );
    assert.deepEqual(remaining, [0, 1]);
  });

  it("does not treat a requestsInCurrentWindow mention as the sliding-window script", () => {
    const memory = createMemoryStore();
    assert.throws(
      () =>
        evalLua(
          memory,
          NAME_ONLY_SCRIPT,
          ["cur", "prev", ""],
          ["1", String(Date.now()), "60000", "1"]
        ),
      /unknown lua script/
    );
  });

  it("accepts the installed @upstash/ratelimit sliding-window scripts", () => {
    const source = readFileSync(
      "node_modules/@upstash/ratelimit/dist/index.mjs",
      "utf8"
    );
    const extract = (varName: string) => {
      const marker = `var ${varName} = \``;
      const start = source.indexOf(marker);
      assert.ok(start >= 0, varName);
      const bodyStart = start + marker.length;
      const end = source.indexOf("`;", bodyStart);
      assert.ok(end > bodyStart, varName);
      return source.slice(bodyStart, end);
    };
    const memory = createMemoryStore();
    const now = Date.now();
    const limit = evalLua(
      memory,
      extract("slidingWindowLimitScript"),
      ["cur", "prev", ""],
      ["2", String(now), "60000", "1"]
    );
    const remaining = evalLua(
      memory,
      extract("slidingWindowRemainingTokensScript"),
      ["cur", "prev", ""],
      ["2", String(now), "60000"]
    );
    assert.deepEqual(limit, [1, 2]);
    assert.deepEqual(remaining, [1, 2]);
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

  it("does not route near-miss ownership text to the production scripts", () => {
    const memory = createMemoryStore();
    runCommand(memory, ["SET", "claim", "token-a"]);
    assert.throws(
      () =>
        evalLua(
          memory,
          'redis.call("set", KEYS[2], "1")',
          ["claim", "processed"],
          ["token-a", "0"]
        ),
      /unknown lua script/
    );
    assert.equal(runCommand(memory, ["GET", "claim"]), "token-a");
    assert.throws(
      () => evalLua(memory, 'redis.call("expire", KEYS[1], ARGV[2])', ["claim"], ["token-a", "30"]),
      /unknown lua script/
    );
    assert.throws(
      () => evalLua(memory, 'redis.call("del", KEYS[1])', ["claim"], ["token-a"]),
      /unknown lua script/
    );
    assert.equal(runCommand(memory, ["GET", "claim"]), "token-a");
  });
});

describe("upstash-rest-mock SET expiry", () => {
  it("clears an existing TTL when SET has no EX or PX", () => {
    const memory = createMemoryStore();
    assert.equal(runCommand(memory, ["SET", "k", "v", "EX", "60"]), "OK");
    assert.ok(Number(runCommand(memory, ["TTL", "k"])) > 0);
    assert.equal(runCommand(memory, ["SET", "k", "v2"]), "OK");
    assert.equal(runCommand(memory, ["GET", "k"]), "v2");
    assert.equal(runCommand(memory, ["TTL", "k"]), -1);
  });

  it("keeps the existing TTL on INCRBY", () => {
    const memory = createMemoryStore();
    runCommand(memory, ["SET", "k", "1", "PX", "60000"]);
    assert.equal(runCommand(memory, ["INCRBY", "k", "2"]), 3);
    assert.ok(Number(runCommand(memory, ["TTL", "k"])) > 0);
    assert.equal(runCommand(memory, ["GET", "k"]), "3");
  });
});

type MockHandle = ReturnType<typeof createUpstashRestMock>["handle"];

async function callHandle(
  handle: MockHandle,
  init: {
    url?: string;
    authorization?: string;
    body?: unknown;
    raw?: string;
    headers?: Record<string, string>;
  }
): Promise<{ status: number; body: unknown }> {
  const raw =
    init.raw ?? (init.body === undefined ? "" : JSON.stringify(init.body));
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

  it("reports invalid JSON from the request handler and keeps an empty body as no command", async () => {
    const mock = createUpstashRestMock({ token: "tok" });
    const invalid = await callHandle(mock.handle, {
      authorization: "Bearer tok",
      raw: "{",
    });
    assert.equal(invalid.status, 200);
    assert.equal(typeof (invalid.body as { error?: unknown }).error, "string");

    const empty = await callHandle(mock.handle, {
      authorization: "Bearer tok",
      raw: "",
    });
    assert.equal(empty.status, 200);
    assert.match(String((empty.body as { error?: unknown }).error), /empty command/);
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
