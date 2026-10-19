import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryStore,
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
