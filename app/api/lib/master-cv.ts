/**
 * Load the canonical Master CV from env (MASTER_CV_JSON preferred, else MASTER_CV_PATH).
 * Fail closed on missing/invalid master; enforce non-world-readable path perms (R1a).
 *
 * First successful load populates a module-level cache so the filesystem is never
 * hit again during the same process lifetime (master CV is read-only at runtime).
 */
import { readFileSync, statSync } from "node:fs";
import { getEnvString } from "../../../lib/env";
import { ServiceError } from "./errors";
import { validateCvJson } from "./cv-schema";

/** Module-level cache: populated on first successful load, never cleared in production. */
let cachedMaster: unknown | undefined;
let cachedSource: "env" | "path" | undefined;

export type MasterCvLoadResult =
  | { ok: true; data: unknown; source: "env" | "path" }
  | { ok: false; error: string };

function isWorldReadable(mode: number): boolean {
  // Other-read bit (S_IROTH = 0o004)
  return (mode & 0o004) !== 0;
}

function loadFromEnvBody(raw: string): MasterCvLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Master CV configuration is invalid" };
  }
  const validated = validateCvJson(parsed);
  if (!validated.ok) {
    return { ok: false, error: "Master CV configuration is invalid" };
  }
  return { ok: true, data: validated.data, source: "env" };
}

function loadFromPath(filePath: string): MasterCvLoadResult {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { ok: false, error: "Master CV configuration is unavailable" };
  }
  if (!stat.isFile()) {
    return { ok: false, error: "Master CV configuration is unavailable" };
  }
  if (isWorldReadable(stat.mode)) {
    return { ok: false, error: "Master CV configuration is unavailable" };
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { ok: false, error: "Master CV configuration is unavailable" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Master CV configuration is invalid" };
  }
  const validated = validateCvJson(parsed);
  if (!validated.ok) {
    return { ok: false, error: "Master CV configuration is invalid" };
  }
  return { ok: true, data: validated.data, source: "path" };
}

/**
 * Resolve master CV from MASTER_CV_JSON or MASTER_CV_PATH.
 * Prefer env body when both are set. Caches on first success — subsequent calls
 * return the cached value without touching the filesystem.
 */
export function loadMasterCv(): MasterCvLoadResult {
  if (cachedMaster !== undefined) {
    return { ok: true, data: cachedMaster, source: cachedSource! };
  }
  const envBody = getEnvString("MASTER_CV_JSON")?.trim();
  let result: MasterCvLoadResult;
  if (envBody) {
    result = loadFromEnvBody(envBody);
  } else {
    const path = getEnvString("MASTER_CV_PATH")?.trim();
    if (path) {
      result = loadFromPath(path);
    } else {
      result = { ok: false, error: "Master CV configuration is unavailable" };
    }
  }
  if (result.ok) {
    cachedMaster = result.data;
    cachedSource = result.source;
  }
  return result;
}

/** Throw ServiceError when master cannot be loaded (route boundary maps to 503). */
export function requireMasterCv(): unknown {
  const result = loadMasterCv();
  if (!result.ok) {
    throw new ServiceError(result.error);
  }
  return result.data;
}

/** Test-only: clear the in-memory master cache so tests can swap env config. */
export function __resetMasterCvCacheForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "__resetMasterCvCacheForTest is only available in the test environment"
    );
  }
  cachedMaster = undefined;
  cachedSource = undefined;
}
