/**
 * Smoke pipeline library: health → tailor → docx validate → dual judges → gates.
 * Script owns env loading, artifact I/O, and process.exit.
 */
import type { CurationMode } from "./curation-mode";
import {
  scoreJsonGrounding as defaultScoreJsonGrounding,
  scoreJsonJdFit as defaultScoreJsonJdFit,
  type JsonGroundingScore,
  type JsonJdFitScore,
} from "./eval-judge";
import { isValidDocxBase64 } from "./markdown-docx";
import { evaluateSmokeJudgeGates } from "./smoke-helpers";

export type SmokePipelineDeps = {
  fetchFn?: typeof fetch;
  scoreJsonGrounding?: typeof defaultScoreJsonGrounding;
  scoreJsonJdFit?: typeof defaultScoreJsonJdFit;
};

export type SmokePipelineOptions = {
  baseUrl: string;
  curationMode: CurationMode;
  apiKey: string;
  judgeModel: string;
  groundingMin?: number;
  jdFitMin?: number;
  deps?: SmokePipelineDeps;
};

export type VerifySmokeSuccess = {
  ok: true;
  curatedJson: unknown;
  docxBase64: string;
  builderVersion: string;
  coverLetter?: string;
  model: string;
  groundingScore: number;
  groundingParseFailed: boolean;
  groundingFlaggedCount: number;
  jdFitScore: number;
  jdFitParseFailed: boolean;
  jdFitReasoning: string;
  gatePassed: boolean;
  gateReasons: string[];
};

export type VerifySmokeFailure = {
  ok: false;
  stage: "health" | "tailor" | "docx" | "judges";
  error: string;
  status?: number;
};

export type VerifySmokeResult = VerifySmokeSuccess | VerifySmokeFailure;

type TailorSmokeResponse = {
  cv?: unknown;
  curatedJson?: unknown;
  builderVersion?: unknown;
  coverLetter?: unknown;
  model?: unknown;
  error?: string;
};

export async function verifySmokePipeline(
  masterCv: unknown,
  jd: string,
  options: SmokePipelineOptions
): Promise<VerifySmokeResult> {
  const fetchFn = options.deps?.fetchFn ?? fetch;
  const scoreGrounding =
    options.deps?.scoreJsonGrounding ?? defaultScoreJsonGrounding;
  const scoreJdFit = options.deps?.scoreJsonJdFit ?? defaultScoreJsonJdFit;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  const healthRes = await fetchFn(`${baseUrl}/api/hello`);
  if (!healthRes.ok) {
    return {
      ok: false,
      stage: "health",
      error: `Health check failed: ${healthRes.status}`,
      status: healthRes.status,
    };
  }
  let healthBody: { status?: string } = {};
  try {
    healthBody = (await healthRes.json()) as { status?: string };
  } catch {
    return {
      ok: false,
      stage: "health",
      error: "Health check returned non-JSON body",
      status: healthRes.status,
    };
  }
  if (healthBody.status !== "ok") {
    return {
      ok: false,
      stage: "health",
      error: `Health check status is ${JSON.stringify(healthBody.status)}`,
      status: healthRes.status,
    };
  }

  const tailorRes = await fetchFn(`${baseUrl}/api/tailor-cv`, {
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
  });

  let data: TailorSmokeResponse = {};
  try {
    data = (await tailorRes.json()) as TailorSmokeResponse;
  } catch {
    return {
      ok: false,
      stage: "tailor",
      error: `HTTP ${tailorRes.status}: non-JSON body`,
      status: tailorRes.status,
    };
  }

  if (!tailorRes.ok) {
    return {
      ok: false,
      stage: "tailor",
      error: `HTTP ${tailorRes.status}: ${data.error ?? "request failed"}`,
      status: tailorRes.status,
    };
  }

  if (
    typeof data.cv !== "string" ||
    data.curatedJson == null ||
    data.builderVersion == null
  ) {
    return {
      ok: false,
      stage: "tailor",
      error: "Missing cv, curatedJson, or builderVersion",
      status: tailorRes.status,
    };
  }

  if (!isValidDocxBase64(data.cv)) {
    return {
      ok: false,
      stage: "docx",
      error: "cv is not a valid docx",
      status: tailorRes.status,
    };
  }

  let grounding: JsonGroundingScore;
  let jdFit: JsonJdFitScore;
  try {
    grounding = await scoreGrounding(
      masterCv,
      data.curatedJson,
      jd,
      options.judgeModel,
      { curationMode: options.curationMode }
    );
    jdFit = await scoreJdFit(
      masterCv,
      data.curatedJson,
      jd,
      options.judgeModel
    );
  } catch (err) {
    return {
      ok: false,
      stage: "judges",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const gate = evaluateSmokeJudgeGates(
    grounding,
    jdFit,
    options.groundingMin != null && options.jdFitMin != null
      ? {
          groundingMin: options.groundingMin,
          jdFitMin: options.jdFitMin,
        }
      : undefined
  );

  let gatePassed = true;
  let gateReasons: string[] = [];
  if (!gate.ok) {
    gatePassed = false;
    gateReasons = gate.reasons;
  }

  const success: VerifySmokeSuccess = {
    ok: true,
    curatedJson: data.curatedJson,
    docxBase64: data.cv,
    builderVersion: String(data.builderVersion),
    model: typeof data.model === "string" ? data.model : "",
    groundingScore: grounding.score,
    groundingParseFailed: grounding.parseFailed,
    groundingFlaggedCount: grounding.flaggedClaims.length,
    jdFitScore: jdFit.score,
    jdFitParseFailed: jdFit.parseFailed,
    jdFitReasoning: jdFit.reasoning,
    gatePassed,
    gateReasons,
  };

  if (
    options.curationMode === "flexible" &&
    typeof data.coverLetter === "string"
  ) {
    success.coverLetter = data.coverLetter;
  }

  return success;
}
