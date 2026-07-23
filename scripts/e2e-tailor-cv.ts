/**
 * Manual live-API smoke for the JSON curator pipeline (KTD9 / F3 / R11).
 * Not wired into `npm test` / CI.
 *
 * Usage:
 *   npm run smoke -- [baseUrl] [jdPath] [--flexible]
 *   npx tsx scripts/e2e-tailor-cv.ts [baseUrl] [jdPath] [--flexible]
 *
 * Requires: running server, TAILOR_API_KEY, MASTER_CV_JSON|PATH, judge model keys.
 * Optional: SMOKE_WRITE_UNREDACTED=1 to write full curated JSON locally (default redacts).
 * Optional: SMOKE_CURATION_MODE=strict|flexible (default strict); --flexible forces flexible.
 */

import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadMasterCv } from "../app/api/lib/master-cv";
import {
  DEFAULT_CURATION_MODE,
  isCurationMode,
  type CurationMode,
} from "../app/api/lib/curation-mode";
import { getEvalJudgeModel } from "../lib/env";
import {
  scoreJsonGrounding,
  scoreJsonJdFit,
} from "../app/api/lib/eval-judge";
import {
  evaluateSmokeJudgeGates,
  redactCuratedForArtifact,
  getSmokeGroundingMin,
  getSmokeJdFitMin,
} from "../app/api/lib/smoke-helpers";

const argv = process.argv.slice(2);
const wantFlexible = argv.includes("--flexible");
const positional = argv.filter((a) => a !== "--flexible");

const BASE_URL =
  positional[0] || process.env.E2E_BASE_URL || "http://localhost:3000";
const JD_PATH_ARG = positional[1];

function resolveCurationMode(): CurationMode {
  if (wantFlexible) return "flexible";
  const fromEnv = process.env.SMOKE_CURATION_MODE?.trim();
  if (fromEnv) {
    if (!isCurationMode(fromEnv)) {
      throw new Error(
        `SMOKE_CURATION_MODE must be "strict" or "flexible" (got ${fromEnv})`
      );
    }
    return fromEnv;
  }
  return DEFAULT_CURATION_MODE;
}

const CURATION_MODE = resolveCurationMode();

function defaultJdPath(): string {
  const dir = join(process.cwd(), "knowledge-base", "test-jds");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    throw new Error(
      `No test-jds directory found at ${dir}. Provide a JD path:\n` +
        `  npm run smoke -- <baseUrl> <path/to/jd.md>`
    );
  }
  if (files.length === 0) {
    throw new Error(`No JD files in ${dir}`);
  }
  return join(dir, files[0]!);
}

function loadJd(): { path: string; text: string } {
  const path = resolve(JD_PATH_ARG || defaultJdPath());
  return { path, text: readFileSync(path, "utf8") };
}

async function healthCheck(): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/hello`);
  if (!res.ok) {
    console.error("Health check failed:", res.status);
    return false;
  }
  const data = (await res.json()) as { status?: string };
  console.log("Health:", data);
  return data.status === "ok";
}

type TailorSmokeResponse = {
  cv?: unknown;
  curatedJson?: unknown;
  builderVersion?: unknown;
  curationMode?: unknown;
  model?: unknown;
  error?: string;
};

async function postTailor(jd: string): Promise<{
  ok: boolean;
  status: number;
  data: TailorSmokeResponse;
  detail: string;
}> {
  const apiKey = process.env.TAILOR_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      data: {},
      detail: "TAILOR_API_KEY is required for smoke",
    };
  }

  const res = await fetch(`${BASE_URL}/api/tailor-cv`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jobDescription: jd,
      sessionId: `smoke-${Date.now()}`,
      curationMode: CURATION_MODE,
    }),
  });

  let data: TailorSmokeResponse = {};
  try {
    data = (await res.json()) as TailorSmokeResponse;
  } catch {
    return {
      ok: false,
      status: res.status,
      data: {},
      detail: `HTTP ${res.status}: non-JSON body`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      detail: `HTTP ${res.status}: ${data.error ?? "request failed"}`,
    };
  }

  if (typeof data.cv !== "string" || !data.curatedJson || !data.builderVersion) {
    return {
      ok: false,
      status: res.status,
      data,
      detail: "Missing cv, curatedJson, or builderVersion",
    };
  }

  const buf = Buffer.from(data.cv, "base64");
  const isDocx = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isDocx) {
    return {
      ok: false,
      status: res.status,
      data,
      detail: "cv is not a docx zip",
    };
  }

  return {
    ok: true,
    status: res.status,
    data,
    detail: `model=${data.model} builder=${data.builderVersion} bytes=${buf.length}`,
  };
}

function writeArtifacts(
  curated: unknown,
  builderVersion: unknown,
  cvBase64: string
): void {
  const dir = join(process.cwd(), "tmp", "smoke");
  mkdirSync(dir, { recursive: true });
  const unredacted = process.env.SMOKE_WRITE_UNREDACTED === "1";
  const payload = {
    builderVersion,
    curatedJson: unredacted ? curated : redactCuratedForArtifact(curated),
    redacted: !unredacted,
  };
  writeFileSync(join(dir, "curated.json"), JSON.stringify(payload, null, 2));
  writeFileSync(join(dir, "cv.docx"), Buffer.from(cvBase64, "base64"));
  console.log(`Wrote artifacts under ${dir} (redacted=${!unredacted})`);
}

async function main(): Promise<void> {
  const master = loadMasterCv();
  if (!master.ok) {
    console.error(`Master CV unavailable: ${master.error}`);
    process.exit(1);
  }

  if (!(await healthCheck())) {
    process.exit(1);
  }

  const jd = loadJd();
  console.log(`JD: ${jd.path}`);
  console.log(`curationMode: ${CURATION_MODE}`);

  const tailor = await postTailor(jd.text);
  console.log(tailor.ok ? "PASS tailor" : "FAIL tailor", tailor.detail);
  if (!tailor.ok) {
    process.exit(1);
  }

  writeArtifacts(
    tailor.data.curatedJson,
    tailor.data.builderVersion,
    tailor.data.cv as string
  );

  const judgeModel = getEvalJudgeModel();
  console.log(
    `Judges: model=${judgeModel} groundingMin=${getSmokeGroundingMin()} jdFitMin=${getSmokeJdFitMin()}`
  );

  let grounding;
  let jdFit;
  try {
    grounding = await scoreJsonGrounding(
      master.data,
      tailor.data.curatedJson,
      jd.text,
      judgeModel,
      { curationMode: CURATION_MODE }
    );
    jdFit = await scoreJsonJdFit(
      master.data,
      tailor.data.curatedJson,
      jd.text,
      judgeModel
    );
  } catch (err) {
    console.error(
      "FAIL judges transport:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }

  console.log(
    `grounding score=${grounding.score} parseFailed=${grounding.parseFailed} flagged=${grounding.flaggedClaims.length}`
  );
  console.log(
    `jd-fit score=${jdFit.score} parseFailed=${jdFit.parseFailed} reasoning=${jdFit.reasoning}`
  );

  const gate = evaluateSmokeJudgeGates(grounding, jdFit);
  if (!gate.ok) {
    console.error("FAIL smoke gates:", gate.reasons.join("; "));
    process.exit(1);
  }

  console.log("PASS smoke");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
