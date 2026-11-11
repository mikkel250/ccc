/**
 * Shared rate-limit mock factories for tests.
 *
 * Imported by tests/rate-limit.test.ts and tests/route.test.ts to eliminate
 * duplicate sliding-window simulator implementations (see AGENTS.md:
 * "80% overlap means extend, don't copy").
 *
 * `RatelimitResponse`/`RatelimitLike` are derived from the real SDK type
 * (`Ratelimit["limit"]`) rather than hand-duplicated, so mocks stay
 * structurally compatible with `__injectRatelimitForTest` without `as any`.
 */
import type { Ratelimit } from "@upstash/ratelimit";

export type RatelimitResponse = Awaited<ReturnType<Ratelimit["limit"]>>;
export type RatelimitLike = Pick<Ratelimit, "limit" | "getRemaining">;

export interface SlidingWindowConfig {
  maxRequests: number;
  windowMs: number;
}

/** In-memory sliding-window simulator matching @upstash/ratelimit SDK shape. */
export function createSlidingWindowMock(config: SlidingWindowConfig): RatelimitLike {
  const buckets = new Map<string, number[]>();

  function liveTimestamps(identifier: string, now: number): number[] {
    const windowStart = now - config.windowMs;
    const timestamps = (buckets.get(identifier) ?? []).filter((t) => t > windowStart);
    buckets.set(identifier, timestamps);
    return timestamps;
  }

  return {
    getRemaining: async (identifier: string) => {
      const now = Date.now();
      const timestamps = liveTimestamps(identifier, now);
      const oldest = timestamps[0] ?? now;
      return {
        remaining: Math.max(0, config.maxRequests - timestamps.length),
        reset: oldest + config.windowMs,
        limit: config.maxRequests,
      };
    },
    limit: async function mockLimit(
      identifier: string,
    ): Promise<RatelimitResponse> {
      // Simulate network latency so concurrent calls interleave
      await new Promise(resolve => setImmediate(resolve));

      const now = Date.now();
      const timestamps = liveTimestamps(identifier, now);
      const oldest = timestamps[0] ?? now;

      const remaining = Math.max(0, config.maxRequests - timestamps.length);

      if (remaining <= 0) {
        return {
          success: false,
          remaining: 0,
          reset: oldest + config.windowMs,
          limit: config.maxRequests,
          pending: Promise.resolve(),
        };
      }

      timestamps.push(now);
      buckets.set(identifier, timestamps);

      return {
        success: true,
        remaining: remaining - 1,
        reset: oldest + config.windowMs,
        limit: config.maxRequests,
        pending: Promise.resolve(),
      };
    },
  };
}

/** Mock that always throws — simulates Upstash Redis connection failure. */
export function createFailingMock(): RatelimitLike {
  return {
    getRemaining: async () => ({
      remaining: 1,
      reset: Date.now() + 60_000,
      limit: 1,
    }),
    limit: async function mockLimit(): Promise<RatelimitResponse> {
      throw new Error("Connection refused");
    },
  };
}

/** Mock that resolves with the SDK's fail-open timeout shape (`reason: "timeout"`). */
export function createTimeoutMock(): RatelimitLike {
  return {
    getRemaining: async () => ({
      remaining: 1,
      reset: Date.now() + 60_000,
      limit: 5,
    }),
    limit: async function mockLimit(): Promise<RatelimitResponse> {
      return {
        success: true,
        remaining: 0,
        reset: 0,
        limit: 5,
        pending: Promise.resolve(),
        reason: "timeout",
      };
    },
  };
}
