/**
 * In-memory IP burst rate limiter for the tailor-cv endpoint.
 *
 * Protects LLM API spend from rapid retries; not a durable per-user quota.
 * `sessionId` is accepted for API compatibility but limiting is keyed on IP.
 * State resets on deploy (stateless MVP). See RATE_LIMIT_* env vars.
 *
 * **Known race (accepted MVP limitation):** check-and-update on `requestLog` is
 * not atomic. Concurrent requests for the same IP can both read the same
 * timestamps array and pass the remaining check before either writes back —
 * e.g. 4 existing timestamps + 2 concurrent requests can yield 6 total,
 * exceeding BURST_MAX. TODO: make atomic (Redis INCR/EXPIRE or per-IP mutex).
 */
// Simple IP-based rate limiting — burst detection only.
// Prevents a single IP from hammering the LLM endpoint.

import { getEnvNumber } from "../../../lib/env";

const requestLog = new Map<string, number[]>();

const BURST_MAX = getEnvNumber("RATE_LIMIT_MAX", 5);
const BURST_WINDOW_MS = getEnvNumber("RATE_LIMIT_WINDOW", 60000); // 1 minute

function pruneExpiredEntries(): void {
  const cutoff = Date.now() - BURST_WINDOW_MS;
  for (const [ip, stamps] of requestLog) {
    const filtered = stamps.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      requestLog.delete(ip);
    } else {
      requestLog.set(ip, filtered);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime?: number;
  message?: string;
}

export function checkRateLimit(
  _sessionId: string,
  ipAddress: string
): RateLimitResult {
  pruneExpiredEntries();

  const now = Date.now();
  const windowStart = now - BURST_WINDOW_MS;

  let timestamps = (requestLog.get(ipAddress) ?? []).filter(
    (t) => t > windowStart
  );

  const remaining = Math.max(0, BURST_MAX - timestamps.length);

  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: timestamps[0] + BURST_WINDOW_MS,
      message: "Too many requests. Please wait before trying again.",
    };
  }

  timestamps.push(now);
  requestLog.set(ipAddress, timestamps);

  return {
    allowed: true,
    remaining: remaining - 1,
    resetTime: now + BURST_WINDOW_MS,
  };
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
}
