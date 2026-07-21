/**
 * Load the canonical Master CV from env (MASTER_CV_JSON preferred, else MASTER_CV_PATH).
 * Fail closed on missing/invalid master; enforce non-world-readable path perms (R1a).
 */
import { readFileSync, statSync } from "node:fs";
import { getEnvString } from "../../../lib/env";
import { ServiceError } from "./errors";
import { validateCvJson } from "./cv-schema";

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
 * Prefer env body when both are set.
 */
export function loadMasterCv(): MasterCvLoadResult {
  const envBody = getEnvString("MASTER_CV_JSON")?.trim();
  if (envBody) {
    return loadFromEnvBody(envBody);
  }
  const path = getEnvString("MASTER_CV_PATH")?.trim();
  if (path) {
    return loadFromPath(path);
  }
  return { ok: false, error: "Master CV configuration is unavailable" };
}

/** Throw ServiceError when master cannot be loaded (route boundary maps to 503). */
export function requireMasterCv(): unknown {
  const result = loadMasterCv();
  if (!result.ok) {
    throw new ServiceError(result.error);
  }
  return result.data;
}
