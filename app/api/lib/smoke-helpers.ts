/**
 * Smoke helpers: threshold evaluation + redact-by-default artifacts (KTD9 / R18).
 */
import { getEnvFloat, getEnvNumber } from "../../../lib/env";
import type { JsonGroundingScore, JsonJdFitScore } from "./eval-judge";

export function getSmokeGroundingMin(): number {
  return Math.min(1, Math.max(0, getEnvFloat("SMOKE_GROUNDING_MIN", 0.7)));
}

export function getSmokeJdFitMin(): number {
  return Math.min(5, Math.max(1, getEnvNumber("SMOKE_JD_FIT_MIN", 3)));
}

export type SmokeJudgeGateResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

/**
 * Fail closed on parseFailed / transport-shaped failures, then enforce mins (R11).
 */
export function evaluateSmokeJudgeGates(
  grounding: JsonGroundingScore,
  jdFit: JsonJdFitScore,
  mins: { groundingMin: number; jdFitMin: number } = {
    groundingMin: getSmokeGroundingMin(),
    jdFitMin: getSmokeJdFitMin(),
  }
): SmokeJudgeGateResult {
  const reasons: string[] = [];

  if (grounding.parseFailed) {
    reasons.push("grounding judge parseFailed");
  }
  if (jdFit.parseFailed) {
    reasons.push("jd-fit judge parseFailed");
  }
  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  if (grounding.flaggedClaims.length > 0) {
    reasons.push(
      `grounding flaggedClaims (${grounding.flaggedClaims.length}) must be empty`
    );
  }
  if (grounding.score < mins.groundingMin) {
    reasons.push(
      `grounding score ${grounding.score} < min ${mins.groundingMin}`
    );
  }
  if (jdFit.score < mins.jdFitMin) {
    reasons.push(`jd-fit score ${jdFit.score} < min ${mins.jdFitMin}`);
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

/** Strip contact + free-text bullets for default local artifact writes. */
export function redactCuratedForArtifact(curated: unknown): unknown {
  if (curated === null || typeof curated !== "object") return curated;
  const src = curated as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  if (src.contact && typeof src.contact === "object") {
    out.contact = { redacted: true };
  }
  if (Array.isArray(src.summary)) {
    out.summary = src.summary.map(() => "[REDACTED]");
  }
  if (Array.isArray(src.experience)) {
    out.experience = src.experience.map((role) => {
      if (!role || typeof role !== "object") return role;
      const r = role as Record<string, unknown>;
      return {
        ...r,
        blurb: r.blurb != null ? "[REDACTED]" : r.blurb,
        bullets: Array.isArray(r.bullets)
          ? r.bullets.map(() => "[REDACTED]")
          : r.bullets,
        subroles: Array.isArray(r.subroles)
          ? r.subroles.map((sr) => {
              if (!sr || typeof sr !== "object") return sr;
              const s = sr as Record<string, unknown>;
              return {
                ...s,
                bullets: Array.isArray(s.bullets)
                  ? s.bullets.map(() => "[REDACTED]")
                  : s.bullets,
              };
            })
          : r.subroles,
      };
    });
  }
  if (Array.isArray(src.projects)) {
    out.projects = src.projects.map((p) => {
      if (!p || typeof p !== "object") return p;
      const proj = p as Record<string, unknown>;
      return {
        ...proj,
        bullets: Array.isArray(proj.bullets)
          ? proj.bullets.map(() => "[REDACTED]")
          : proj.bullets,
      };
    });
  }
  return out;
}
