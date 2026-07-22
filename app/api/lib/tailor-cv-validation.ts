/**
 * Request boundary validation for POST /api/tailor-cv.
 * Keeps parsing/typing out of the route handler — the route maps `{ ok: false }` to HTTP 400.
 */
import {
  DEFAULT_CURATION_MODE,
  isCurationMode,
  type CurationMode,
} from "./curation-mode";
import { getTailorJdMaxChars } from "./cv-schema";

export interface TailorCvRequestBody {
  jobDescription?: unknown;
  sessionId?: unknown;
  curationMode?: unknown;
  [key: string]: unknown;
}

export type ValidateTailorCvResult =
  | {
      ok: true;
      jobDescription: string;
      sessionId: string;
      curationMode: CurationMode;
    }
  | { ok: false; error: string };

function isTailorCvRequestBody(record: Record<string, unknown>): record is TailorCvRequestBody {
  return true;
}

export function validateTailorCvBody(
  body: unknown,
  fallbackSessionId: string
): ValidateTailorCvResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be an object" };
  }

  const record = body as Record<string, unknown>;
  if (!isTailorCvRequestBody(record)) {
    return { ok: false, error: "Request body must be an object" };
  }

  const jd = record.jobDescription;

  if (jd === undefined || jd === null) {
    return { ok: false, error: "jobDescription is required." };
  }

  if (typeof jd !== "string" || jd.trim().length === 0) {
    return { ok: false, error: "jobDescription must be a non-empty string." };
  }

  const trimmed = jd.trim();
  const maxChars = getTailorJdMaxChars();
  if (trimmed.length > maxChars) {
    return { ok: false, error: "jobDescription exceeds configured size limit." };
  }

  const rawMode = record.curationMode;
  let curationMode: CurationMode = DEFAULT_CURATION_MODE;
  if (rawMode !== undefined && rawMode !== null) {
    if (!isCurationMode(rawMode)) {
      return {
        ok: false,
        error: 'curationMode must be "strict" or "flexible".',
      };
    }
    curationMode = rawMode;
  }

  const sessionId =
    typeof record.sessionId === "string" && record.sessionId.trim().length > 0
      ? record.sessionId.trim()
      : fallbackSessionId;

  return { ok: true, jobDescription: trimmed, sessionId, curationMode };
}
