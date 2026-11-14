/**
 * Config-only readiness: can this process serve POST /api/tailor-cv without
 * immediately 503ing on missing auth, master CV, or Redis credentials.
 *
 * No LLM calls, no Redis ping. Master CV uses the startup preload cache, or
 * loads once if instrumentation has not finished (avoids Railway healthcheck
 * races). A network ping would restart the service on Upstash blips while
 * tailor already fail-closes those per request.
 */
import { getEnvString } from "../../../lib/env";
import { preloadMasterCv } from "./master-cv";
import { authenticateTailorRequest } from "./tailor-auth";

export type ReadinessCheck = "ok" | "failed";

export type ReadinessChecks = {
  auth: ReadinessCheck;
  masterCv: ReadinessCheck;
  redis: ReadinessCheck;
};

export type ReadinessResult = {
  ok: boolean;
  checks: ReadinessChecks;
};

function checkAuth(): ReadinessCheck {
  const result = authenticateTailorRequest(null);
  if (result.ok) return "ok";
  return result.status === 401 ? "ok" : "failed";
}

function checkRedis(): ReadinessCheck {
  const url = getEnvString("UPSTASH_REDIS_REST_URL");
  const token = getEnvString("UPSTASH_REDIS_REST_TOKEN");
  return url && token ? "ok" : "failed";
}

export async function evaluateReadiness(): Promise<ReadinessResult> {
  const master = await preloadMasterCv();
  const checks: ReadinessChecks = {
    auth: checkAuth(),
    masterCv: master.ok ? "ok" : "failed",
    redis: checkRedis(),
  };
  return {
    ok:
      checks.auth === "ok" &&
      checks.masterCv === "ok" &&
      checks.redis === "ok",
    checks,
  };
}
