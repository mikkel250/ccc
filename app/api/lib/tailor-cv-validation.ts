export interface TailorCvRequestBody {
  jobDescription?: unknown;
  sessionId?: unknown;
}

export type ValidateTailorCvResult =
  | { ok: true; jobDescription: string; sessionId: string }
  | { ok: false; error: string };

export function validateTailorCvBody(
  body: TailorCvRequestBody,
  fallbackSessionId: string
): ValidateTailorCvResult {
  const jd = body.jobDescription;

  if (jd === undefined || jd === null) {
    return { ok: false, error: "jobDescription is required." };
  }

  if (typeof jd !== "string" || jd.trim().length === 0) {
    return { ok: false, error: "jobDescription must be a non-empty string." };
  }

  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim().length > 0
      ? body.sessionId.trim()
      : fallbackSessionId;

  return { ok: true, jobDescription: jd.trim(), sessionId };
}
