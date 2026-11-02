#!/usr/bin/env node
/**
 * Upstash Redis REST stand-in for local CCC rate limiting and inbox KV.
 * Speaks the HTTP command-array protocol used by @upstash/redis (incl. /pipeline).
 *
 * Sliding-window EVAL matches @upstash/ratelimit: return [remaining, limit],
 * with remaining = -1 when the request is denied. EVALSHA answers NOSCRIPT
 * so the SDK falls back to EVAL (same as a cold Upstash instance).
 *
 * String results are raw JSON unless the request sends `Upstash-Encoding: base64`
 * (the header @upstash/redis sets by default). `OK`, null, and numbers stay raw.
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import {
  DELETE_IF_VALUE_SCRIPT,
  EXPIRE_IF_OWNED_SCRIPT,
  MARK_PROCESSED_IF_OWNED_SCRIPT,
} from "../app/api/lib/inbox-redis-scripts.mjs";

export const DEFAULT_UPSTASH_REST_PORT = 8079;
export const DEFAULT_UPSTASH_REST_TOKEN = "local-dev-upstash-token";

/**
 * @typedef {{ value: string, expiresAt: number | null }} StoreEntry
 */

export function nowMs() {
  return Date.now();
}

export function createMemoryStore() {
  /** @type {Map<string, StoreEntry>} */
  const store = new Map();

  function getEntry(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt != null && entry.expiresAt <= nowMs()) {
      store.delete(key);
      return null;
    }
    return entry;
  }

  function setValue(key, value, expiresAt) {
    store.set(key, { value, expiresAt: expiresAt ?? null });
  }

  function pttl(key) {
    const entry = getEntry(key);
    if (!entry) return -2;
    if (entry.expiresAt == null) return -1;
    return Math.max(0, entry.expiresAt - nowMs());
  }

  function incrBy(key, amount) {
    const entry = getEntry(key);
    const next = (entry ? Number(entry.value) || 0 : 0) + amount;
    setValue(key, String(next), entry?.expiresAt ?? null);
    return next;
  }

  function del(key) {
    getEntry(key);
    return store.delete(key) ? 1 : 0;
  }

  return { store, getEntry, setValue, pttl, incrBy, del };
}

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {ReturnType<typeof createMemoryStore>} memory
 * @param {string[]} keys
 * @param {Array<string | number>} args
 * @param {boolean} increment
 */
export function slidingWindowEval(memory, keys, args, increment) {
  const currentKey = keys[0] ?? "ratelimit";
  const previousKey = keys[1] ?? `${currentKey}:prev`;
  const dynamicLimitKey = keys[2] ?? "";
  const tokens = numeric(args[0], 5);
  const now = numeric(args[1], nowMs());
  const window = numeric(args[2], 60_000);
  const incrementBy = increment ? numeric(args[3], 1) : 0;

  let effectiveLimit = tokens;
  if (dynamicLimitKey) {
    const dynamic = memory.getEntry(dynamicLimitKey);
    if (dynamic) {
      effectiveLimit = numeric(dynamic.value, tokens);
    }
  }

  const currentRaw = memory.getEntry(currentKey);
  const previousRaw = memory.getEntry(previousKey);
  let requestsInCurrentWindow = currentRaw ? numeric(currentRaw.value, 0) : 0;
  let requestsInPreviousWindow = previousRaw ? numeric(previousRaw.value, 0) : 0;
  const percentageInCurrent = window > 0 ? (now % window) / window : 0;
  requestsInPreviousWindow = Math.floor(
    (1 - percentageInCurrent) * requestsInPreviousWindow
  );

  if (!increment) {
    const used = requestsInPreviousWindow + requestsInCurrentWindow;
    return [effectiveLimit - used, effectiveLimit];
  }

  if (incrementBy > 0 && requestsInPreviousWindow + requestsInCurrentWindow >= effectiveLimit) {
    return [-1, effectiveLimit];
  }

  const newValue = memory.incrBy(currentKey, incrementBy);
  if (newValue === incrementBy) {
    const entry = memory.getEntry(currentKey);
    memory.setValue(currentKey, entry?.value ?? String(newValue), now + window * 2 + 1000);
  }
  return [effectiveLimit - (newValue + requestsInPreviousWindow), effectiveLimit];
}

function getString(memory, key) {
  return memory.getEntry(key)?.value ?? null;
}

/** @param {string} script */
function redisCallNames(script) {
  return [...script.matchAll(/redis\.call\(\s*["']([A-Za-z]+)["']/gi)].map((match) =>
    match[1].toUpperCase()
  );
}

/**
 * Sliding-window scripts from @upstash/ratelimit: overlap math plus two bucket GETs.
 * A variable name alone is not enough.
 * @param {string} script
 */
export function isSlidingWindowScript(script) {
  if (!/\bnow\s*%\s*window\b/.test(script)) return false;
  const calls = redisCallNames(script);
  if (calls.filter((name) => name === "GET").length < 2) return false;
  if (calls.includes("HMGET") || calls.includes("HSET")) return false;
  if (calls.includes("INCRBY") && !calls.includes("PEXPIRE") && !calls.includes("EXPIRE")) {
    return false;
  }
  return true;
}

/**
 * @param {ReturnType<typeof createMemoryStore>} memory
 * @param {string[]} keys
 * @param {string[]} args
 */
function markProcessedIfOwned(memory, keys, args) {
  const claimKey = keys[0];
  const processedKey = keys[1];
  const token = args[0];
  const ttlSeconds = numeric(args[1], 0);
  if (getString(memory, claimKey) !== token) {
    return 0;
  }
  if (ttlSeconds > 0) {
    memory.setValue(processedKey, "1", nowMs() + ttlSeconds * 1000);
  } else {
    memory.setValue(processedKey, "1", null);
  }
  memory.del(claimKey);
  return 1;
}

/**
 * @param {ReturnType<typeof createMemoryStore>} memory
 * @param {string[]} keys
 * @param {string[]} args
 */
function expireIfOwned(memory, keys, args) {
  const key = keys[0];
  const token = args[0];
  const ttlSeconds = numeric(args[1], 0);
  if (getString(memory, key) !== token) {
    return 0;
  }
  const entry = memory.getEntry(key);
  if (!entry) return 0;
  memory.setValue(key, entry.value, nowMs() + ttlSeconds * 1000);
  return 1;
}

/**
 * @param {ReturnType<typeof createMemoryStore>} memory
 * @param {string[]} keys
 * @param {string[]} args
 */
function deleteIfValue(memory, keys, args) {
  const key = keys[0];
  const token = args[0];
  if (getString(memory, key) !== token) {
    return 0;
  }
  return memory.del(key);
}

/**
 * @param {ReturnType<typeof createMemoryStore>} memory
 * @param {string} script
 * @param {string[]} keys
 * @param {string[]} args
 */
export function evalLua(memory, script, keys, args) {
  if (script === MARK_PROCESSED_IF_OWNED_SCRIPT) {
    return markProcessedIfOwned(memory, keys, args);
  }
  if (script === EXPIRE_IF_OWNED_SCRIPT) {
    return expireIfOwned(memory, keys, args);
  }
  if (script === DELETE_IF_VALUE_SCRIPT) {
    return deleteIfValue(memory, keys, args);
  }
  if (isSlidingWindowScript(script)) {
    return slidingWindowEval(
      memory,
      keys,
      args,
      redisCallNames(script).includes("INCRBY")
    );
  }
  const calls = redisCallNames(script);
  if (calls.length === 1 && calls[0] === "GET") {
    return getString(memory, keys[0] ?? "");
  }
  throw new Error("ERR unknown lua script");
}

function requestsBase64Encoding(req) {
  const headers = req?.headers ?? {};
  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== "upstash-encoding") continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return String(value ?? "").toLowerCase() === "base64";
  }
  return false;
}

export function encodeUpstashResult(result) {
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

/**
 * @param {ReturnType<typeof createMemoryStore>} memory
 * @param {unknown} command
 */
export function runCommand(memory, command) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error("ERR empty command");
  }
  const op = String(command[0]).toUpperCase();
  const args = command.slice(1);
  switch (op) {
    case "PING":
      return "PONG";
    case "GET":
      return memory.getEntry(String(args[0]))?.value ?? null;
    case "SET": {
      const key = String(args[0]);
      const value = String(args[1]);
      let expiresAt = null;
      let nx = false;
      let xx = false;
      for (let i = 2; i < args.length; i += 1) {
        const flag = String(args[i]).toUpperCase();
        if (flag === "EX") {
          expiresAt = nowMs() + numeric(args[i + 1]) * 1000;
          i += 1;
        } else if (flag === "PX") {
          expiresAt = nowMs() + numeric(args[i + 1]);
          i += 1;
        } else if (flag === "NX") {
          nx = true;
        } else if (flag === "XX") {
          xx = true;
        }
      }
      const existing = memory.getEntry(key);
      if (nx && existing) return null;
      if (xx && !existing) return null;
      memory.setValue(key, value, expiresAt);
      return "OK";
    }
    case "INCR":
      return memory.incrBy(String(args[0]), 1);
    case "INCRBY":
      return memory.incrBy(String(args[0]), numeric(args[1]));
    case "DEL":
      return args.reduce((n, key) => n + memory.del(String(key)), 0);
    case "PEXPIRE": {
      const entry = memory.getEntry(String(args[0]));
      if (!entry) return 0;
      memory.setValue(String(args[0]), entry.value, nowMs() + numeric(args[1]));
      return 1;
    }
    case "EXPIRE": {
      const entry = memory.getEntry(String(args[0]));
      if (!entry) return 0;
      memory.setValue(String(args[0]), entry.value, nowMs() + numeric(args[1]) * 1000);
      return 1;
    }
    case "PTTL":
      return memory.pttl(String(args[0]));
    case "TTL": {
      const ms = memory.pttl(String(args[0]));
      if (ms < 0) return ms;
      return Math.ceil(ms / 1000);
    }
    case "EVALSHA":
      throw new Error("NOSCRIPT No matching script. Please use EVAL.");
    case "EVAL": {
      const script = String(args[0]);
      const numKeys = numeric(args[1], 0);
      const keys = args.slice(2, 2 + numKeys).map(String);
      const rest = args.slice(2 + numKeys).map(String);
      return evalLua(memory, script, keys, rest);
    }
    case "SCRIPT":
      return "OK";
    default:
      throw new Error(`ERR unknown command '${op}'`);
  }
}

export function createUpstashRestMock(options = {}) {
  const memory = options.memory ?? createMemoryStore();
  const token =
    options.token ??
    process.env.UPSTASH_REST_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    DEFAULT_UPSTASH_REST_TOKEN;

  function wrap(result, req) {
    if (options.encode === false || !requestsBase64Encoding(req)) return result;
    return encodeUpstashResult(result);
  }

  async function handle(req, res) {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && (req.url === "/health" || req.url?.startsWith("/health?"))) {
      send(200, { status: "ok" });
      return;
    }
    const header = req.headers.authorization || "";
    if (header !== `Bearer ${token}`) {
      send(401, { error: "Unauthorized" });
      return;
    }
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const path = req.url || "/";
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      if (path.startsWith("/pipeline") || (Array.isArray(parsed) && Array.isArray(parsed[0]))) {
        const results = parsed.map((cmd) => {
          try {
            return { result: wrap(runCommand(memory, cmd), req) };
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
          }
        });
        send(200, results);
        return;
      }
      send(200, { result: wrap(runCommand(memory, parsed), req) });
    } catch (error) {
      send(200, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { memory, handle, runCommand: (command) => runCommand(memory, command) };
}

export function listenUpstashRestMock(options = {}) {
  const port = Number(options.port ?? process.env.UPSTASH_REST_PORT ?? DEFAULT_UPSTASH_REST_PORT);
  const mock = createUpstashRestMock(options);
  const server = http.createServer((req, res) => {
    void mock.handle(req, res);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`upstash-rest-mock listening on http://127.0.0.1:${port}`);
  });
  return { server, mock };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  listenUpstashRestMock();
}
