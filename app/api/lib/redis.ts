/**
 * Shared Upstash Redis client — lazy singleton for rate limiting and future Redis features.
 *
 * Credentials from UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (Upstash console → REST API).
 * Client is created on first use, not at module import time (same pattern as llm.ts provider clients).
 */
import {
  EvalCommand,
  GetCommand,
  Redis,
  SetCommand,
  type SetCommandOptions,
} from "@upstash/redis";

type UpstashRequester = {
  request: <TResult = unknown>(
    req: unknown
  ) => Promise<{ result?: TResult; error?: string }>;
};

function requester(client: Redis): UpstashRequester {
  return (client as Redis & { client: UpstashRequester }).client;
}

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

export async function getRedisKey(
  client: Redis,
  key: string,
  signal?: AbortSignal
): Promise<unknown> {
  const cmdOpts = signal ? { streamOptions: { signal } } : undefined;
  return new GetCommand([key], cmdOpts).exec(requester(client));
}

export async function setRedisKey(
  client: Redis,
  key: string,
  value: string,
  opts: SetCommandOptions | undefined,
  signal?: AbortSignal
): Promise<unknown> {
  const cmdOpts = signal ? { streamOptions: { signal } } : undefined;
  return new SetCommand([key, value, opts], cmdOpts).exec(requester(client));
}

export async function evalRedisScript(
  client: Redis,
  script: string,
  key: string,
  args: string[],
  signal?: AbortSignal
): Promise<unknown> {
  const cmdOpts = signal ? { streamOptions: { signal } } : undefined;
  return new EvalCommand<[string], number>(
    [script, [key], args as [string]],
    cmdOpts
  ).exec(requester(client));
}

/** For tests only — clears the cached client so env changes take effect. */
export function resetRedisClientForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("resetRedisClientForTest is only available in the test environment");
  }
  redisClient = null;
}
