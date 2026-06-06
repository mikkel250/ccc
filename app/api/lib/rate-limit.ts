/**
 * In-memory IP burst rate limiter for the tailor-cv endpoint.
 *
 * Protects LLM API spend from rapid retries; not a durable per-user quota.
 * `sessionId` is accepted for API compatibility but limiting is keyed on IP.
 * State resets on deploy (stateless MVP). See RATE_LIMIT_* env vars.
 *
 * Concurrent same-IP requests are serialized via a per-IP promise chain.
 * Multi-instance deploys still need Redis INCR/EXPIRE for cross-process atomicity.
 */
import { getEnvNumber } from "../../../lib/env";

const requestLog = new Map<string, number[]>();
const ipChains = new Map<string, Promise<void>>();

const BURST_MAX = getEnvNumber("RATE_LIMIT_MAX", 5);
const BURST_WINDOW_MS = getEnvNumber("RATE_LIMIT_WINDOW", 60000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime?: number;
  message?: string;
}

function activeTimestamps(ipAddress: string, now: number): number[] {
  const windowStart = now - BURST_WINDOW_MS;
  return (requestLog.get(ipAddress) ?? []).filter((t) => t > windowStart);
}

// [SHARED-STATE] Drops expired per-IP bucket and chain entries to avoid unbounded map growth.
function pruneIdleIpState(ipAddress: string, now = Date.now()): void {
  const timestamps = activeTimestamps(ipAddress, now);
  if (timestamps.length === 0) {
    if (requestLog.has(ipAddress)) {
      requestLog.delete(ipAddress);
      ipChains.delete(ipAddress);
    }
    return;
  }

  const stored = requestLog.get(ipAddress);
  if (stored && stored.length !== timestamps.length) {
    requestLog.set(ipAddress, timestamps);
  }
}

// [SHARED-STATE] [SIDE-EFFECT] Schedules in-process cleanup when the current bucket fully expires.
function scheduleIdlePrune(ipAddress: string): void {
  const timestamps = requestLog.get(ipAddress);
  if (!timestamps?.length) {
    return;
  }

  const expiresAt = timestamps[0]! + BURST_WINDOW_MS;
  const delay = expiresAt - Date.now();
  if (delay <= 0) {
    pruneIdleIpState(ipAddress);
    return;
  }

  setTimeout(() => {
    pruneIdleIpState(ipAddress);
  }, delay);
}

function checkRateLimitSync(ipAddress: string): RateLimitResult {
  const now = Date.now();
  pruneIdleIpState(ipAddress, now);

  const timestamps = activeTimestamps(ipAddress, now);
  const remaining = Math.max(0, BURST_MAX - timestamps.length);

  if (remaining <= 0) {
    const stored = requestLog.get(ipAddress);
    if (stored && stored.length !== timestamps.length) {
      requestLog.set(ipAddress, timestamps);
    }

    return {
      allowed: false,
      remaining: 0,
      resetTime: timestamps[0]! + BURST_WINDOW_MS,
      message: "Too many requests. Please wait before trying again.",
    };
  }

  timestamps.push(now);
  requestLog.set(ipAddress, timestamps);

  return {
    allowed: true,
    remaining: remaining - 1,
    resetTime: timestamps[0]! + BURST_WINDOW_MS,
  };
}

export function checkRateLimit(
  _sessionId: string,
  ipAddress: string
): Promise<RateLimitResult> {
  const previous = ipChains.get(ipAddress) ?? Promise.resolve();
  const result = previous.then(() => checkRateLimitSync(ipAddress));
  ipChains.set(
    ipAddress,
    result.then(
      () => {},
      () => {}
    )
  );
  void result.finally(() => {
    scheduleIdlePrune(ipAddress);
  });
  return result;
}

export function getRateLimitConfig() {
  return {
    maxRequests: BURST_MAX,
    windowMs: BURST_WINDOW_MS,
  };
}

/** For tests only — resets the in-memory store */
export function resetStore(): void {
  requestLog.clear();
  ipChains.clear();
}

/** For tests only — seed a bucket without going through checkRateLimit */
export function seedBucketForTest(ipAddress: string, timestamps: number[]): void {
  requestLog.set(ipAddress, [...timestamps]);
}

/** For tests only — read current bucket length for an IP */
export function getBucketLengthForTest(ipAddress: string): number {
  return requestLog.get(ipAddress)?.length ?? 0;
}

/** For tests only — whether requestLog still tracks an IP */
export function hasRequestLogEntryForTest(ipAddress: string): boolean {
  return requestLog.has(ipAddress);
}

/** For tests only — whether ipChains still tracks an IP */
export function hasIpChainEntryForTest(ipAddress: string): boolean {
  return ipChains.has(ipAddress);
}
