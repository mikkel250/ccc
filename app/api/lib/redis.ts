/**
 * Shared Upstash Redis client — lazy singleton for rate limiting and inbox KV.
 *
 * Credentials from UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (Upstash console → REST API).
 * Client is created on first use, not at module import time (same pattern as llm.ts provider clients).
 *
 * Import only the runtime public surface (`Redis` plus type-only `SetCommandOptions`).
 * `@upstash/redis` 1.38 types re-export `GetCommand` / `SetCommand` / `EvalCommand`,
 * but the ESM/CJS entry exports only `Redis`, `SearchIndex`, and `errors`. Named
 * Command imports compile in TypeScript and then fail in Next.js webpack
 * ("is not exported") and at runtime (`XCommand is not a constructor`).
 */
import { Redis, type SetCommandOptions } from "@upstash/redis";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    if (!url) {
      throw new Error("UPSTASH_REDIS_REST_URL is not configured");
    }
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!token) {
      throw new Error("UPSTASH_REDIS_REST_TOKEN is not configured");
    }
    // [SHARED-STATE] Lazy singleton — one Redis client reused across requests.
    redisClient = new Redis({ url, token });
  }
  return redisClient;
}

/** Command subset used by helpers — structural so tests can pass fakes without asserting `Redis`. */
type RedisGetClient = {
  get: (key: string) => Promise<unknown>;
};

type RedisSetClient = {
  set: (
    key: string,
    value: string,
    opts?: SetCommandOptions
  ) => Promise<unknown>;
};

type RedisEvalClient = {
  eval: (
    script: string,
    keys: string[],
    args: string[]
  ) => Promise<unknown>;
};

export async function getRedisKey(
  client: RedisGetClient,
  key: string
): Promise<unknown> {
  return client.get(key);
}

export async function setRedisKey(
  client: RedisSetClient,
  key: string,
  value: string,
  opts?: SetCommandOptions
): Promise<unknown> {
  return client.set(key, value, opts);
}

export async function evalRedisScript(
  client: RedisEvalClient,
  script: string,
  key: string,
  args: string[]
): Promise<unknown> {
  return client.eval(script, [key], args);
}

/** For tests only — clears the cached client so env changes take effect. */
export function resetRedisClientForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("resetRedisClientForTest is only available in the test environment");
  }
  redisClient = null;
}
