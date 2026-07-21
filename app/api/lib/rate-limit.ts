/**
 * Rate limiter backed by Upstash Redis via @upstash/ratelimit SDK.
 *
 * Dual fail-closed ceilings (R21 / KTD7): per-IP and per-shared-secret hash.
 * Success responses return the more restrictive remaining/resetTime.
 * sessionId is accepted for future auth integration; not used as an anti-exfil key.
 */
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { ServiceError } from "./errors";
import { getRedisClient } from "./redis";
import { getEnvNumber, getEnvString } from "../../../lib/env";

const RATE_LIMIT_MAX = Math.max(1, Math.floor(getEnvNumber("RATE_LIMIT_MAX", 5)));
// Per-secret ceiling defaults to half the per-IP cap so key sharing cannot
// inflate overall throughput beyond a single authenticated consumer.
const RATE_LIMIT_SECRET_MAX = Math.max(
  1,
  Math.floor(getEnvNumber("RATE_LIMIT_SECRET_MAX", Math.max(1, Math.floor(RATE_LIMIT_MAX / 2))))
);
const RATE_LIMIT_WINDOW_MS = Math.max(1, Math.floor(getEnvNumber("RATE_LIMIT_WINDOW", 60000)));
const RATE_LIMIT_REDIS_PREFIX = getEnvString("RATE_LIMIT_REDIS_PREFIX", "ratelimit") ?? "ratelimit";
const RATE_LIMIT_TIMEOUT_MS = Math.max(
  1,
  Math.floor(getEnvNumber("RATE_LIMIT_TIMEOUT_MS", 2000))
);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  message?: string;
}

export function getRateLimitConfig() {
  return {
    maxRequests: RATE_LIMIT_MAX,
    secretMaxRequests: RATE_LIMIT_SECRET_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
    timeoutMs: RATE_LIMIT_TIMEOUT_MS,
  };
}

/** Stable Redis key material from the shared secret — never store the raw key. */
export function hashTailorApiKeyForRateLimit(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex").slice(0, 32);
}

type RatelimitLike = Pick<Ratelimit, "limit">;

let ipRatelimit: RatelimitLike | null = null;
let secretRatelimit: RatelimitLike | null = null;

function getIpRatelimit(): RatelimitLike {
  if (!ipRatelimit) {
    ipRatelimit = new Ratelimit({
      redis: getRedisClient(),
      limiter: Ratelimit.slidingWindow(
        RATE_LIMIT_MAX,
        `${RATE_LIMIT_WINDOW_MS} ms`
      ),
      prefix: RATE_LIMIT_REDIS_PREFIX,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    });
  }
  return ipRatelimit;
}

function getSecretRatelimit(): RatelimitLike {
  if (!secretRatelimit) {
    secretRatelimit = new Ratelimit({
      redis: getRedisClient(),
      limiter: Ratelimit.slidingWindow(
        RATE_LIMIT_SECRET_MAX,
        `${RATE_LIMIT_WINDOW_MS} ms`
      ),
      prefix: `${RATE_LIMIT_REDIS_PREFIX}:secret`,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    });
  }
  return secretRatelimit;
}

/**
 * Inject or reset the IP Ratelimit singleton for tests.
 * Pass a mock to replace, or null to force re-creation on next call.
 */
export function __injectRatelimitForTest(r: RatelimitLike | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__injectRatelimitForTest is only available in the test environment");
  }
  ipRatelimit = r;
}

/** Inject or reset the secret-bucket Ratelimit singleton for tests. */
export function __injectSecretRatelimitForTest(r: RatelimitLike | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__injectSecretRatelimitForTest is only available in the test environment");
  }
  secretRatelimit = r;
}

async function runLimit(
  rl: RatelimitLike,
  key: string
): Promise<RateLimitResult> {
  try {
    const result = await rl.limit(key);
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

function moreRestrictive(
  a: RateLimitResult,
  b: RateLimitResult
): RateLimitResult {
  const allowed = a.allowed && b.allowed;
  const remaining = Math.min(a.remaining, b.remaining);
  const resetTime = Math.max(a.resetTime, b.resetTime);
  if (!allowed) {
    return {
      allowed: false,
      remaining,
      resetTime,
      message: "Too many requests. Please wait before trying again.",
    };
  }
  return { allowed: true, remaining, resetTime };
}

/**
 * Check IP and shared-secret rate-limit buckets (both must succeed).
 * Secret bucket is checked first so secret exhaustion does not burn IP quota.
 *
 * @param _sessionId Reserved — not used as an anti-exfil identity.
 * @param ipIdentifier Client IP from x-forwarded-for.
 * @param secretBucketKey Hash of the presented shared secret (or bypass token).
 */
export async function checkRateLimit(
  _sessionId: string,
  ipIdentifier: string,
  secretBucketKey: string
): Promise<RateLimitResult> {
  const ipRl = getIpRatelimit();
  const secretRl = getSecretRatelimit();
  const secretResult = await runLimit(secretRl, secretBucketKey);
  if (!secretResult.allowed) {
    return secretResult;
  }
  const ipResult = await runLimit(ipRl, ipIdentifier);
  return moreRestrictive(ipResult, secretResult);
}
