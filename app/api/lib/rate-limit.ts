/**
 * Rate limiter backed by Upstash Redis via @upstash/ratelimit SDK.
 *
 * Dual fail-closed ceilings (R21 / KTD7): per-caller (IP or `session:<id>`)
 * and per-shared-secret hash. Success responses return the more restrictive
 * remaining/resetTime. Body sessionId keys the per-caller bucket only after
 * successful Bearer/bypass auth in the HTTP adapter; the secret hash remains
 * the anti-exfil cap. A denial already recorded for that caller or secret key
 * is served from a process-local cache until its reset, so retries do not
 * read Redis. Keys that are not cached still take the authoritative check.
 */
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { ServiceError } from "./errors";
import { getRedisClient } from "./redis";
import { getEnvNumber, getEnvString } from "../../../lib/env";

const RATE_LIMIT_MAX = Math.max(1, Math.floor(getEnvNumber("RATE_LIMIT_MAX", 5)));
// Per-secret ceiling defaults to half the per-caller cap so key sharing cannot
// inflate overall throughput beyond a single authenticated consumer. Raise
// RATE_LIMIT_SECRET_MAX when multiple BFF users should each get RATE_LIMIT_MAX.
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
const RATE_LIMIT_SESSION_ID_MAX_CHARS = Math.max(
  1,
  Math.floor(getEnvNumber("RATE_LIMIT_SESSION_ID_MAX_CHARS", 128))
);
const RATE_LIMIT_DENIAL_CACHE_MAX = Math.max(
  1,
  Math.floor(getEnvNumber("RATE_LIMIT_DENIAL_CACHE_MAX", 256))
);
const SESSION_RATE_LIMIT_KEY_PREFIX = "session:";
const SESSION_ID_CHARSET = /^[A-Za-z0-9_-]+$/;

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
    sessionIdMaxChars: RATE_LIMIT_SESSION_ID_MAX_CHARS,
    denialCacheMax: RATE_LIMIT_DENIAL_CACHE_MAX,
  };
}

/** True when a trimmed sessionId may key the per-caller bucket. */
export function isUsableRateLimitSessionId(sessionId: string): boolean {
  return (
    sessionId.length > 0 &&
    sessionId.length <= RATE_LIMIT_SESSION_ID_MAX_CHARS &&
    SESSION_ID_CHARSET.test(sessionId)
  );
}

/**
 * Choose the per-caller Redis identifier.
 * Usable body sessionId → `session:<id>` so it cannot collide with an IP key.
 * Missing or invalid sessionId → the parsed client IP (caller must already
 * have passed the unknown-IP 400). Auth gating belongs in the HTTP adapter.
 */
export function resolveCallerRateLimitKey(
  sessionId: unknown,
  ipAddress: string
): string {
  if (typeof sessionId !== "string") {
    return ipAddress;
  }
  const trimmed = sessionId.trim();
  if (!isUsableRateLimitSessionId(trimmed)) {
    return ipAddress;
  }
  return `${SESSION_RATE_LIMIT_KEY_PREFIX}${trimmed}`;
}

/** Stable Redis key material from the shared secret — never store the raw key. */
export function hashTailorApiKeyForRateLimit(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex").slice(0, 32);
}

type RatelimitLike = Pick<Ratelimit, "limit" | "getRemaining">;

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
  clearRateLimitDenials();
  ipRatelimit = r;
}

/** Inject or reset the secret-bucket Ratelimit singleton for tests. */
export function __injectSecretRatelimitForTest(r: RatelimitLike | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__injectSecretRatelimitForTest is only available in the test environment");
  }
  clearRateLimitDenials();
  secretRatelimit = r;
}

/**
 * `Ratelimit.getRemaining` does not use the SDK timeout that `limit` does.
 * Bound the peek locally so a hung Redis read fails closed instead of holding
 * the request.
 */
async function withRateLimitDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ServiceError("Rate limit service unavailable"));
    }, RATE_LIMIT_TIMEOUT_MS);
  });
  // A peek that loses the race can still reject later. Attach a handler so
  // that rejection is not unhandled.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function peekCallerRemaining(
  rl: RatelimitLike,
  callerIdentifier: string
): Promise<{ remaining: number; reset: number }> {
  try {
    return await withRateLimitDeadline(rl.getRemaining(callerIdentifier));
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    throw new ServiceError("Rate limit service unavailable", { cause: error });
  }
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

const callerDenials = new Map<string, number>();
const secretDenials = new Map<string, number>();

function clearRateLimitDenials(): void {
  callerDenials.clear();
  secretDenials.clear();
}

function deniedResult(resetTime: number): RateLimitResult {
  return {
    allowed: false,
    remaining: 0,
    resetTime,
    message: "Too many requests. Please wait before trying again.",
  };
}

/**
 * Remember a Redis denial until `resetTime`, clamped to one window.
 * Returns the reset this process will honor, or undefined when the denial
 * should not be cached (caller still returns the Redis result).
 */
function rememberDenial(
  cache: Map<string, number>,
  key: string,
  resetTime: number
): number | undefined {
  const now = Date.now();
  if (!Number.isFinite(resetTime) || resetTime <= now) {
    return undefined;
  }
  const bounded = Math.min(resetTime, now + RATE_LIMIT_WINDOW_MS);
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, bounded);
  while (cache.size > RATE_LIMIT_DENIAL_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
  return bounded;
}

function cachedDenial(
  cache: Map<string, number>,
  key: string
): RateLimitResult | undefined {
  const resetTime = cache.get(key);
  if (resetTime === undefined) {
    return undefined;
  }
  if (Date.now() >= resetTime) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, resetTime);
  return deniedResult(resetTime);
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
 * Check per-caller and shared-secret rate-limit buckets (both must succeed).
 * An exhausted caller is denied before the secret bucket increments. Otherwise
 * the secret bucket is checked first so secret exhaustion does not burn caller quota.
 * Repeats of a caller or secret denial already in the local cache return before
 * any Redis read; the cache expires at reset (at most one window) and drops the
 * oldest key when it is full, and those requests hit Redis again.
 *
 * @param _sessionId Unused at this layer — pipeline resolves the caller key.
 * @param callerIdentifier Parsed client IP, or `session:<id>` from
 *   {@link resolveCallerRateLimitKey}.
 * @param secretBucketKey Hash of the presented shared secret (or bypass token).
 */
export async function checkRateLimit(
  _sessionId: string,
  callerIdentifier: string,
  secretBucketKey: string
): Promise<RateLimitResult> {
  const cachedCaller = cachedDenial(callerDenials, callerIdentifier);
  if (cachedCaller) {
    return cachedCaller;
  }
  const cachedSecret = cachedDenial(secretDenials, secretBucketKey);
  if (cachedSecret) {
    return cachedSecret;
  }

  const callerRl = getIpRatelimit();
  const secretRl = getSecretRatelimit();
  // A caller already at its ceiling must not increment the shared secret
  // window. Peek first (no consume). Two concurrent requests can both observe
  // remaining 1 and both proceed; that is one extra admit, not a retry loop.
  const callerPeek = await peekCallerRemaining(callerRl, callerIdentifier);
  if (callerPeek.remaining <= 0) {
    const resetTime = rememberDenial(
      callerDenials,
      callerIdentifier,
      callerPeek.reset
    );
    return deniedResult(resetTime ?? callerPeek.reset);
  }
  // Sequential: secret-first, then per-caller. Secret exhaustion must not burn
  // caller quota (R21 / plan design decision), so we cannot fire both in
  // parallel. The ~50ms extra latency in the common (both-allowed) case is an
  // intentional tradeoff.
  const secretResult = await runLimit(secretRl, secretBucketKey);
  if (!secretResult.allowed) {
    const resetTime = rememberDenial(
      secretDenials,
      secretBucketKey,
      secretResult.resetTime
    );
    if (resetTime === undefined) {
      return secretResult;
    }
    return { ...secretResult, remaining: 0, resetTime };
  }
  const callerResult = await runLimit(callerRl, callerIdentifier);
  if (!callerResult.allowed) {
    const resetTime = rememberDenial(
      callerDenials,
      callerIdentifier,
      callerResult.resetTime
    );
    if (resetTime !== undefined) {
      return { ...callerResult, remaining: 0, resetTime };
    }
  }
  return moreRestrictive(callerResult, secretResult);
}
