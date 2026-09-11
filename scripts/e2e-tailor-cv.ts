/**
 * Manual live-API smoke for the JSON curator pipeline (KTD9 / F3 / R11).
 * Not wired into `npm test` / CI.
 *
 * Usage:
 *   npm run smoke -- [baseUrl] [jdPath] [--flexible] [--parity]
 *   npx tsx scripts/e2e-tailor-cv.ts [baseUrl] [jdPath] [--flexible] [--parity]
 *
 * Requires: running server, TAILOR_API_KEY.
 * Server-side MASTER_CV_* is the running server's concern, not this client's.
 * Optional: SMOKE_WRITE_UNREDACTED=1 to write full curated JSON locally (default redacts).
 * Optional: SMOKE_CURATION_MODE=strict|flexible (default strict); --flexible forces flexible.
 * Optional: --parity nests artifacts under tmp/smoke/<provider>/<model>/ and writes
 *   parity-status.json. One live TAILOR_MODEL per process; remaining catalog cells
 *   need a server restart. Catalog: SMOKE_PARITY_MODELS.
 */

import { config as loadDotenv } from "dotenv";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_CURATION_MODE,
  isCurationMode,
  type CurationMode,
} from "../app/api/lib/curation-mode";
import {
  mergeParityStatus,
  parseParityStatusJson,
  parseSmokeParityModels,
  pendingParityModels,
  redactCuratedForArtifact,
  shouldWriteCoverLetterDocx,
  shouldWriteReplyText,
  smokeArtifactPaths,
  smokeParityArtifactDir,
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
  replyText?: unknown;
  artifactDir?: string;
  model?: string;
};

export async function writeSmokeArtifacts(
  input: WriteSmokeArtifactsInput
): Promise<{
  slug: string;
  curatedPath: string;
  docxPath: string;
  coverLetterPath: string;
  replyPath: string;
}> {
  const dir =
    input.artifactDir ?? join(process.cwd(), "tmp", "smoke");
  const paths = smokeArtifactPaths(input.jdPath, dir, input.model);
  mkdirSync(dirname(paths.curatedPath), { recursive: true });
  if (
    existsSync(paths.curatedPath) ||
    existsSync(paths.docxPath) ||
    existsSync(paths.coverLetterPath) ||
    existsSync(paths.replyPath)
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

  if (shouldWriteReplyText(input.curationMode, input.replyText)) {
    writeFileSync(paths.replyPath, input.replyText.trim(), "utf8");
    console.log(`Wrote ${paths.replyPath}`);
  } else {
    rmSync(paths.replyPath, { force: true });
    if (input.curationMode === "strict") {
      console.warn("Reply text missing or empty for strict run, skipping reply file");
    }
  }

  return paths;
}

export type RunSmokeCliOptions = {
  baseUrl: string;
  jdPath?: string;
  wantFlexible: boolean;
  artifactDir?: string;
  parity?: boolean;
  deps?: SmokePipelineDeps;
};

export async function runSmokeCli(options: RunSmokeCliOptions): Promise<void> {
  const curationMode = resolveCurationMode(options.wantFlexible);

  const jd = loadJd(options.jdPath);
  console.log(`JD: ${jd.path}`);
  console.log(`curationMode: ${curationMode}`);

  const apiKey = process.env.TAILOR_API_KEY?.trim();
  if (!apiKey) {
    console.error("TAILOR_API_KEY is required for smoke");
    process.exit(1);
  }

  const smokeRoot = options.artifactDir ?? join(process.cwd(), "tmp", "smoke");
  let catalog: string[] = [];
  if (options.parity) {
    try {
      catalog = parseSmokeParityModels();
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  const result = await verifySmokePipeline(jd.text, {
    baseUrl: options.baseUrl,
    curationMode,
    apiKey,
    deps: options.deps,
  });

  if (!result.ok) {
    console.error(`FAIL ${result.stage}:`, result.error);
    process.exit(1);
  }

  console.log(
    `PASS tailor model=${result.model} builder=${result.builderVersion}`
  );

  if (options.parity) {
    if (!result.model.trim()) {
      console.error("parity mode requires a non-empty response model");
      process.exit(1);
    }
    try {
      if (!catalog.includes(result.model)) {
        throw new Error(
          `parity response model is not in SMOKE_PARITY_MODELS: ${result.model}`
        );
      }
      smokeParityArtifactDir(smokeRoot, result.model);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  await writeSmokeArtifacts({
    jdPath: jd.path,
    curated: result.curatedJson,
    builderVersion: result.builderVersion,
    cvBase64: result.docxBase64,
    curationMode,
    coverLetter: result.coverLetter,
    replyText: result.replyText,
    artifactDir: smokeRoot,
    model: options.parity ? result.model : undefined,
  });

  if (options.parity) {
    const statusPath = join(smokeRoot, "parity-status.json");
    let existing = null;
    if (existsSync(statusPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(statusPath, "utf8"));
        existing = parseParityStatusJson(parsed);
      } catch {
        console.error("Invalid parity-status.json");
        process.exit(1);
      }
    }
    const next = mergeParityStatus(existing, result.model, true);
    const pending = pendingParityModels(catalog, next);
    writeFileSync(
      statusPath,
      JSON.stringify({ ...next, pending }, null, 2)
    );
    if (pending.length > 0) {
      console.log(
        `Parity pending — restart npm run dev with TAILOR_MODEL=<model> and re-run smoke:parity: ${pending.join(", ")}`
      );
    } else {
      console.log("Parity catalog complete");
    }
  }

  console.log("PASS smoke");
  process.exit(0);
}

async function main(): Promise<void> {
  loadDotenv();
  const argv = process.argv.slice(2);
  const wantFlexible = argv.includes("--flexible");
  const parity = argv.includes("--parity");
  const positional = argv.filter(
    (a) => a !== "--flexible" && a !== "--parity"
  );
  const baseUrl =
    positional[0] || process.env.E2E_BASE_URL || "http://localhost:3000";
  const jdPath = positional[1];

  await runSmokeCli({
    baseUrl,
    jdPath,
    wantFlexible,
    parity,
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
