// Simple IP-based rate limiting — burst detection only.
// Prevents a single IP from hammering the LLM endpoint.

const requestLog = new Map<string, number[]>();

const BURST_MAX = parseInt(process.env.RATE_LIMIT_MAX || "5");
const BURST_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW || "60000"); // 1 minute

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

  // Periodic cleanup to prevent unbounded memory growth
  if (requestLog.size > 1000) {
    const cutoff = Date.now() - BURST_WINDOW_MS;
    for (const [ip, stamps] of requestLog) {
      const filtered = stamps.filter((t) => t > cutoff);
      if (filtered.length === 0) {
        requestLog.delete(ip);
      }
    }
  }

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
