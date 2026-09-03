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

import { config as loadDotenv } from "dotenv";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadMasterCv } from "../app/api/lib/master-cv";
import {
  DEFAULT_CURATION_MODE,
  isCurationMode,
  type CurationMode,
} from "../app/api/lib/curation-mode";
import { getEvalJudgeModel } from "../lib/env";
import {
  redactCuratedForArtifact,
  getSmokeGroundingMin,
  getSmokeJdFitMin,
  shouldWriteCoverLetterDocx,
  smokeArtifactPaths,
} from "../app/api/lib/smoke-helpers";
import {
  markdownToDocxBase64,
  isValidDocxBase64,
} from "../app/api/lib/markdown-docx";
import {
  verifySmokePipeline,
  type SmokePipelineDeps,
} from "../app/api/lib/smoke-runner";

export function resolveCurationMode(
  wantFlexible: boolean,
  fromEnv: string | undefined = process.env.SMOKE_CURATION_MODE?.trim()
): CurationMode {
  if (wantFlexible) return "flexible";
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

function loadJd(jdPathArg?: string): { path: string; text: string } {
  const path = resolve(jdPathArg || defaultJdPath());
  return { path, text: readFileSync(path, "utf8") };
}

export type WriteSmokeArtifactsInput = {
  jdPath: string;
  curated: unknown;
  builderVersion: unknown;
  cvBase64: string;
  curationMode: CurationMode;
  coverLetter: unknown;
  artifactDir?: string;
};

export async function writeSmokeArtifacts(
  input: WriteSmokeArtifactsInput
): Promise<{
  slug: string;
  curatedPath: string;
  docxPath: string;
  coverLetterPath: string;
}> {
  const dir =
    input.artifactDir ?? join(process.cwd(), "tmp", "smoke");
  mkdirSync(dir, { recursive: true });
  const paths = smokeArtifactPaths(input.jdPath, dir);
  if (
    existsSync(paths.curatedPath) ||
    existsSync(paths.docxPath) ||
    existsSync(paths.coverLetterPath)
  ) {
    console.warn(
      `Overwriting existing smoke artifacts for JD basename ${JSON.stringify(paths.slug)}`
    );
  }
  const unredacted = process.env.SMOKE_WRITE_UNREDACTED === "1";
  const payload = {
    builderVersion: input.builderVersion,
    curatedJson: unredacted
      ? input.curated
      : redactCuratedForArtifact(input.curated),
    redacted: !unredacted,
  };
  writeFileSync(paths.curatedPath, JSON.stringify(payload, null, 2));
  writeFileSync(paths.docxPath, Buffer.from(input.cvBase64, "base64"));
  console.log(
    `Wrote ${paths.docxPath} and ${paths.curatedPath} (redacted=${!unredacted})`
  );

  if (input.curationMode === "flexible") {
    if (shouldWriteCoverLetterDocx(input.curationMode, input.coverLetter)) {
      try {
        const clBase64 = await markdownToDocxBase64(input.coverLetter);
        if (!isValidDocxBase64(clBase64)) {
          console.warn(
            "Cover-letter DOCX failed validation after conversion, skipping write"
          );
        } else {
          writeFileSync(paths.coverLetterPath, Buffer.from(clBase64, "base64"));
          console.log(`Wrote ${paths.coverLetterPath}`);
        }
      } catch (err) {
        console.warn(
          "Cover-letter DOCX conversion failed, skipping:",
          err instanceof Error ? err.message : err
        );
      }
    } else {
      console.warn(
        "Cover letter missing or empty for flexible run, skipping cover-letter DOCX"
      );
    }
  }

  return paths;
}

export type RunSmokeCliOptions = {
  baseUrl: string;
  jdPath?: string;
  wantFlexible: boolean;
  artifactDir?: string;
  deps?: SmokePipelineDeps;
};

export async function runSmokeCli(options: RunSmokeCliOptions): Promise<void> {
  const curationMode = resolveCurationMode(options.wantFlexible);
  const master = loadMasterCv();
  if (!master.ok) {
    console.error(`Master CV unavailable: ${master.error}`);
    process.exit(1);
  }

  const jd = loadJd(options.jdPath);
  console.log(`JD: ${jd.path}`);
  console.log(`curationMode: ${curationMode}`);

  const apiKey = process.env.TAILOR_API_KEY?.trim();
  if (!apiKey) {
    console.error("TAILOR_API_KEY is required for smoke");
    process.exit(1);
  }

  const judgeModel = getEvalJudgeModel();
  const groundingMin = getSmokeGroundingMin();
  const jdFitMin = getSmokeJdFitMin();
  console.log(
    `Judges: model=${judgeModel} groundingMin=${groundingMin} jdFitMin=${jdFitMin}`
  );

  const result = await verifySmokePipeline(master.data, jd.text, {
    baseUrl: options.baseUrl,
    curationMode,
    apiKey,
    judgeModel,
    groundingMin,
    jdFitMin,
    deps: options.deps,
  });

  if (!result.ok) {
    console.error(`FAIL ${result.stage}:`, result.error);
    if (
      result.stage === "judges" &&
      result.docxBase64 != null &&
      result.curatedJson != null
    ) {
      await writeSmokeArtifacts({
        jdPath: jd.path,
        curated: result.curatedJson,
        builderVersion: result.builderVersion,
        cvBase64: result.docxBase64,
        curationMode,
        coverLetter: result.coverLetter,
        artifactDir: options.artifactDir,
      });
    }
    process.exit(1);
  }

  console.log(
    `PASS tailor model=${result.model} builder=${result.builderVersion}`
  );
  console.log(
    `grounding score=${result.groundingScore} parseFailed=${result.groundingParseFailed} flagged=${result.groundingFlaggedCount}`
  );
  console.log(
    `jd-fit score=${result.jdFitScore} parseFailed=${result.jdFitParseFailed} reasoning=${result.jdFitReasoning}`
  );

  await writeSmokeArtifacts({
    jdPath: jd.path,
    curated: result.curatedJson,
    builderVersion: result.builderVersion,
    cvBase64: result.docxBase64,
    curationMode,
    coverLetter: result.coverLetter,
    artifactDir: options.artifactDir,
  });

  if (!result.gatePassed) {
    console.error("FAIL smoke gates:", result.gateReasons.join("; "));
    process.exit(1);
  }

  console.log("PASS smoke");
  process.exit(0);
}

async function main(): Promise<void> {
  loadDotenv();
  const argv = process.argv.slice(2);
  const wantFlexible = argv.includes("--flexible");
  const positional = argv.filter((a) => a !== "--flexible");
  const baseUrl =
    positional[0] || process.env.E2E_BASE_URL || "http://localhost:3000";
  const jdPath = positional[1];

  await runSmokeCli({
    baseUrl,
    jdPath,
    wantFlexible,
  });
}

/** Canonical href for the entry script, so symlinked invocation paths still count as a direct run. */
export function isDirectRunScript(entryPath: string | undefined): boolean {
  if (entryPath == null) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(resolve(entryPath))).href;
  } catch {
    return import.meta.url === pathToFileURL(resolve(entryPath)).href;
  }
}

const isDirectRun = isDirectRunScript(process.argv[1]);

if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
