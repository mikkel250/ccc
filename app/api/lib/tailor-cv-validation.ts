/**
 * Request boundary validation for POST /api/tailor-cv.
 * Keeps parsing/typing out of the route handler — the route maps `{ ok: false }` to HTTP 400.
 */
export interface TailorCvRequestBody {
  jobDescription?: unknown;
  sessionId?: unknown;
  [key: string]: unknown;
}

export type ValidateTailorCvResult =
  | { ok: true; jobDescription: string; sessionId: string }
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

  const sessionId =
    typeof record.sessionId === "string" && record.sessionId.trim().length > 0
      ? record.sessionId.trim()
      : fallbackSessionId;

  return { ok: true, jobDescription: jd.trim(), sessionId };
}
