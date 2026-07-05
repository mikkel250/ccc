/**
 * Live smoke test against the real Upstash-backed rate limiter.
 *
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env
 * (real Upstash console credentials, not the test-only stubs used in
 * `npm test`). Calls `checkRateLimit` directly rather than driving the
 * full HTTP pipeline — isolates real-Redis rate-limit behavior from
 * LLM/knowledge-base setup that may not be configured locally.
 *
 * Usage: npx tsx scripts/verify-rate-limit.ts
 */

import "dotenv/config";
import { checkRateLimit, getRateLimitConfig } from "../app/api/lib/rate-limit";

async function main() {
  const hasCredentials =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!hasCredentials) {
    console.warn(
      "Skipping rate-limit smoke test: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set in .env"
    );
    process.exit(0);
  }

  const config = getRateLimitConfig();
  const identifier = `smoke-${Date.now()}`;
  let failed = 0;

  console.log(
    `Testing against real Upstash Redis — maxRequests=${config.maxRequests}, windowMs=${config.windowMs}, identifier=${identifier}`
  );

  let prevRemaining: number | null = null;

  for (let i = 0; i < config.maxRequests; i++) {
    const result = await checkRateLimit("smoke-script", identifier);
    const monotonic =
      prevRemaining === null || result.remaining < prevRemaining;
    const ok = result.allowed === true && monotonic;
    console.log(
      `${ok ? "PASS" : "FAIL"} request ${i + 1}/${config.maxRequests}: allowed=${result.allowed} remaining=${result.remaining}${prevRemaining !== null ? ` (prev=${prevRemaining})` : ""}`
    );
    if (!ok) failed++;
    prevRemaining = result.remaining;
  }

  const blocked = await checkRateLimit("smoke-script", identifier);
  const blockedOk =
    blocked.allowed === false &&
    blocked.remaining === 0 &&
    typeof blocked.resetTime === "number" &&
    blocked.resetTime > Date.now();
  console.log(
    `${blockedOk ? "PASS" : "FAIL"} request ${config.maxRequests + 1}/${config.maxRequests}: expected blocked, got allowed=${blocked.allowed} remaining=${blocked.remaining} resetTime=${blocked.resetTime}`
  );
  if (!blockedOk) failed++;

  console.log(
    failed === 0
      ? "\nAll rate-limit smoke checks passed against real Upstash Redis."
      : `\n${failed} smoke check(s) failed.`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Rate-limit smoke test crashed:", err);
  process.exit(1);
});
