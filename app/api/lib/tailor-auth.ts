/**
 * Shared-secret gate for POST /api/tailor-cv (R5b / R5d / KTD4).
 *
 * Present `Authorization: Bearer <TAILOR_API_KEY>`. Local insecure bypass is
 * opt-in via TAILOR_AUTH_INSECURE_BYPASS and hard-blocked when any production
 * deploy marker is present.
 */
import { timingSafeEqual } from "node:crypto";
import { getEnvBoolean, getEnvString } from "../../../lib/env";

export type TailorAuthResult =
  | { ok: true; mode: "bearer" | "bypass" }
  | { ok: false; status: 401 | 503; error: string };

/** True when NODE_ENV or a platform deploy marker indicates production. */
export function isProductionLikeDeploy(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const railway = process.env.RAILWAY_ENVIRONMENT?.trim().toLowerCase();
  if (railway === "production") return true;
  if (process.env.VERCEL_ENV?.trim().toLowerCase() === "production") return true;
  return false;
}

export function isTailorAuthBypassRequested(): boolean {
  return getEnvBoolean("TAILOR_AUTH_INSECURE_BYPASS", false);
}

export function getConfiguredTailorApiKey(): string | undefined {
  return getEnvString("TAILOR_API_KEY")?.trim() || undefined;
}

function bearerTokenEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Constant-time-ish length mismatch: compare against self then fail.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
}

/**
 * Authenticate a tailor request. Call before master load / LLM / rate-limit work
 * that should not run for anonymous callers.
 */
export function authenticateTailorRequest(
  authorizationHeader: string | null
): TailorAuthResult {
  const bypassRequested = isTailorAuthBypassRequested();
  const productionLike = isProductionLikeDeploy();

  if (bypassRequested && productionLike) {
    return {
      ok: false,
      status: 503,
      error: "Service unavailable",
    };
  }

  const configuredKey = getConfiguredTailorApiKey();

  if (productionLike && !configuredKey) {
    return {
      ok: false,
      status: 503,
      error: "Service unavailable",
    };
  }

  if (bypassRequested && !productionLike) {
    return { ok: true, mode: "bypass" };
  }

  if (!configuredKey) {
    // Local/dev without key and without bypass: fail closed (do not serve open).
    return {
      ok: false,
      status: 503,
      error: "Service unavailable",
    };
  }

  const token = parseBearerToken(authorizationHeader);
  if (!token || !bearerTokenEquals(token, configuredKey)) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
    };
  }

  return { ok: true, mode: "bearer" };
}
