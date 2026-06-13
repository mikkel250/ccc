/**
 * Rate limiter backed by Upstash Redis via @upstash/ratelimit SDK.
 *
 * Sliding-window IP-burst detection — one Redis INCR/Lua eval per check.
 * sessionId is accepted for future auth integration; limiting is keyed on
 * the identifier argument (currently IP from x-forwarded-for / x-real-ip).
 * State is durable across deploys — lives in Upstash Redis, not process memory.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { ServiceError } from "./errors";
import { getRedisClient } from "./redis";
import { getEnvNumber, getEnvString } from "../../../lib/env";

const RATE_LIMIT_MAX = Math.max(1, Math.floor(getEnvNumber("RATE_LIMIT_MAX", 5)));
const RATE_LIMIT_WINDOW_MS = Math.max(1, Math.floor(getEnvNumber("RATE_LIMIT_WINDOW", 60000)));
const RATE_LIMIT_REDIS_PREFIX = getEnvString("RATE_LIMIT_REDIS_PREFIX", "ratelimit") ?? "ratelimit";
const RATE_LIMIT_TIMEOUT_MS = Math.max(
  1,
  Math.floor(getEnvNumber("RATE_LIMIT_TIMEOUT_MS", 2000))
);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime?: number;
  message?: string;
}

export function getRateLimitConfig() {
  return {
    maxRequests: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
    timeoutMs: RATE_LIMIT_TIMEOUT_MS,
  };
}

// ---- Ratelimit singleton (lazy, same pattern as redis.ts and llm.ts) ----

type RatelimitLike = Pick<Ratelimit, "limit">;

let ratelimit: RatelimitLike | null = null;

function getRatelimit(): RatelimitLike {
  if (!ratelimit) {
    // [SHARED-STATE] Lazy singleton — one Ratelimit instance reused across requests.
    ratelimit = new Ratelimit({
      redis: getRedisClient(),
      limiter: Ratelimit.slidingWindow(
        RATE_LIMIT_MAX,
        `${RATE_LIMIT_WINDOW_MS} ms`
      ),
      prefix: RATE_LIMIT_REDIS_PREFIX,
      // SDK default 5s fail-opens (success:true). Bounded timeout + reason check below fails closed.
      timeout: RATE_LIMIT_TIMEOUT_MS,
    });
  }
  return ratelimit;
}

/**
 * Inject or reset the Ratelimit singleton for tests.
 * Pass a mock to replace, or null to force re-creation on next call.
 * Not part of the runtime API.
 */
export function __injectRatelimitForTest(r: RatelimitLike | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__injectRatelimitForTest is only available in the test environment");
  }
  ratelimit = r;
}

// ---- Public API ----

export async function checkRateLimit(
  _sessionId: string,
  identifier: string
): Promise<RateLimitResult> {
  // getRatelimit() is outside the try block — config errors (missing env vars,
  // invalid SDK parameters) propagate with clear messages rather than being
  // swallowed by the ServiceError wrapper.
  const rl = getRatelimit();
  try {
    const result = await rl.limit(identifier);
    if (result.reason === "timeout") {
      throw new ServiceError("Rate limit service unavailable");
    }
    return {
      allowed: result.success,
      remaining: result.remaining,
      resetTime: result.reset,
      ...(result.success
        ? {}
        : { message: "Too many requests. Please wait before trying again." }),
    };
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    throw new ServiceError("Rate limit service unavailable", { cause: error });
  }
}
