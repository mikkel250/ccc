/**
 * Smoke pipeline library: health → tailor → docx/schema validate.
 * Script owns env loading, artifact I/O, and process.exit.
 */
import type { CurationMode } from "./curation-mode";
import { validateCvJson } from "./cv-schema";
import { isValidDocxBase64 } from "./markdown-docx";

export type SmokePipelineDeps = {
  fetchFn?: typeof fetch;
};

export type SmokePipelineOptions = {
  baseUrl: string;
  curationMode: CurationMode;
  apiKey: string;
  deps?: SmokePipelineDeps;
};

export type VerifySmokeSuccess = {
  ok: true;
  curatedJson: unknown;
  docxBase64: string;
  builderVersion: string;
  coverLetter?: string;
  model: string;
};

export type VerifySmokeFailure = {
  ok: false;
  stage: "health" | "tailor" | "docx";
  error: string;
  status?: number;
  curatedJson?: unknown;
  docxBase64?: string;
  builderVersion?: string;
  coverLetter?: string;
};

export type VerifySmokeResult = VerifySmokeSuccess | VerifySmokeFailure;

const HEALTH_JSON_FIELDS = ["status"] as const;
const TAILOR_JSON_FIELDS = [
  "cv",
  "curatedJson",
  "builderVersion",
  "coverLetter",
  "model",
  "error",
] as const;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRecord<K extends string>(
  value: unknown,
  keys: readonly K[]
): { [P in K]?: unknown } {
  if (!isJsonRecord(value)) {
    return {};
  }
  const out: { [P in K]?: unknown } = {};
  for (const key of keys) {
    if (Object.hasOwn(value, key)) {
      out[key] = value[key];
    }
  }
  return out;
}

async function fetchForStage(
  fetchFn: typeof fetch,
  stage: "health" | "tailor",
  input: string,
  init?: RequestInit
): Promise<{ ok: true; response: Response } | VerifySmokeFailure> {
  try {
    return { ok: true, response: await fetchFn(input, init) };
  } catch (err) {
    return { ok: false, stage, error: errorMessage(err) };
  }
}

export async function verifySmokePipeline(
  jd: string,
  options: SmokePipelineOptions
): Promise<VerifySmokeResult> {
  const fetchFn = options.deps?.fetchFn ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  const healthAttempt = await fetchForStage(
    fetchFn,
    "health",
    `${baseUrl}/api/hello`
  );
  if (!healthAttempt.ok) {
    return healthAttempt;
  }
  const healthRes = healthAttempt.response;
  if (!healthRes.ok) {
    return {
      ok: false,
      stage: "health",
      error: `Health check failed: ${healthRes.status}`,
      status: healthRes.status,
    };
  }
  let healthParsed: unknown;
  try {
    healthParsed = await healthRes.json();
  } catch {
    return {
      ok: false,
      stage: "health",
      error: "Health check returned non-JSON body",
      status: healthRes.status,
    };
  }
  const healthBody = jsonRecord(healthParsed, HEALTH_JSON_FIELDS);
  if (healthBody.status !== "ok") {
    return {
      ok: false,
      stage: "health",
      error: `Health check status is ${JSON.stringify(healthBody.status)}`,
      status: healthRes.status,
    };
  }

  const tailorAttempt = await fetchForStage(
    fetchFn,
    "tailor",
    `${baseUrl}/api/tailor-cv`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        jobDescription: jd,
        sessionId: `smoke-${Date.now()}`,
        curationMode: options.curationMode,
      }),
    }
  );
  if (!tailorAttempt.ok) {
    return tailorAttempt;
  }
  const tailorRes = tailorAttempt.response;

  let tailorParsed: unknown;
  try {
    tailorParsed = await tailorRes.json();
  } catch {
    return {
      ok: false,
      stage: "tailor",
      error: `HTTP ${tailorRes.status}: non-JSON body`,
      status: tailorRes.status,
    };
  }
  const data = jsonRecord(tailorParsed, TAILOR_JSON_FIELDS);

  if (!tailorRes.ok) {
    return {
      ok: false,
      stage: "tailor",
      error: `HTTP ${tailorRes.status}: ${typeof data.error === "string" ? data.error : "request failed"}`,
      status: tailorRes.status,
    };
  }

  if (
    typeof data.cv !== "string" ||
    data.curatedJson == null ||
    typeof data.builderVersion !== "string"
  ) {
    return {
      ok: false,
      stage: "tailor",
      error: "Missing cv, curatedJson, or builderVersion",
      status: tailorRes.status,
    };
  }
  const docxBase64 = data.cv;
  const builderVersion = data.builderVersion;

  if (!isValidDocxBase64(docxBase64)) {
    return {
      ok: false,
      stage: "docx",
      error: "cv is not a valid docx",
      status: tailorRes.status,
    };
  }

  const schemaResult = validateCvJson(data.curatedJson);
  if (!schemaResult.ok) {
    return {
      ok: false,
      stage: "tailor",
      error: schemaResult.error,
      status: tailorRes.status,
    };
  }
  const curatedJson = schemaResult.data;

  const success: VerifySmokeSuccess = {
    ok: true,
    curatedJson,
    docxBase64,
    builderVersion,
    model: typeof data.model === "string" ? data.model : "",
  };

  if (
    options.curationMode === "flexible" &&
    typeof data.coverLetter === "string"
  ) {
    success.coverLetter = data.coverLetter;
  }

  return success;
}
