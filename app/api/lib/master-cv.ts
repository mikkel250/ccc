/**
 * Load the canonical Master CV from env (MASTER_CV_JSON preferred, else MASTER_CV_PATH).
 * Fail closed on missing/invalid master; enforce non-world-readable path perms (R1a).
 *
 * Production: `preloadMasterCv()` runs at server startup (async fs). Request path
 * `requireMasterCv()` serves the preloaded cache only — no sync disk I/O.
 * Smoke CLI / tests may call `loadMasterCv()` which can resolve + cache synchronously.
 *
 * Cache lives on `globalThis` so Next.js instrumentation and the route bundle
 * share one instance (each webpack graph would otherwise get its own module scope).
 */
import { readFileSync, statSync, constants } from "node:fs";
import { open } from "node:fs/promises";
import { getEnvString } from "../../../lib/env";
import { ServiceError } from "./errors";
import { validateCvJson } from "./cv-schema";

export type MasterCvLoadResult =
  | { ok: true; data: unknown; source: "env" | "path" }
  | { ok: false; error: string };

/** globalThis key for the shared preload cache (overridable via env). */
const MASTER_CV_CACHE_KEY =
  getEnvString("MASTER_CV_CACHE_KEY", "__cccMasterCvCache") ?? "__cccMasterCvCache";

function getCachedResult(): MasterCvLoadResult | undefined {
  return Reflect.get(globalThis, MASTER_CV_CACHE_KEY) as
    | MasterCvLoadResult
    | undefined;
}

function setCachedResult(result: MasterCvLoadResult | undefined): void {
  if (result === undefined) {
    Reflect.deleteProperty(globalThis, MASTER_CV_CACHE_KEY);
  } else {
    Reflect.set(globalThis, MASTER_CV_CACHE_KEY, result);
  }
}

function isWorldReadable(mode: number): boolean {
  // Other-read bit (S_IROTH = 0o004)
  return (mode & 0o004) !== 0;
}

function validateParsed(parsed: unknown, source: "env" | "path"): MasterCvLoadResult {
  const validated = validateCvJson(parsed);
  if (!validated.ok) {
    return { ok: false, error: "Master CV configuration is invalid" };
  }
  return { ok: true, data: validated.data, source };
}

function parseAndValidate(raw: string, source: "env" | "path"): MasterCvLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Master CV configuration is invalid" };
  }
  return validateParsed(parsed, source);
}

function loadFromEnvBody(raw: string): MasterCvLoadResult {
  return parseAndValidate(raw, "env");
}

async function loadFromPathAsync(filePath: string): Promise<MasterCvLoadResult> {
  let handle;
  try {
    // O_NOFOLLOW: refuse to open via symlink; fstat/read use the same descriptor.
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return { ok: false, error: "Master CV configuration is unavailable" };
  }

  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      return { ok: false, error: "Master CV configuration is unavailable" };
    }
    if (isWorldReadable(fileStat.mode)) {
      return { ok: false, error: "Master CV configuration is unavailable" };
    }

    const raw = await handle.readFile("utf8");
    return parseAndValidate(raw, "path");
  } catch {
    return { ok: false, error: "Master CV configuration is unavailable" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Sync path load for smoke CLI / unit tests only — not used on the HTTP request path. */
function loadFromPathSync(filePath: string): MasterCvLoadResult {
  let fileStat;
  try {
    fileStat = statSync(filePath);
  } catch {
    return { ok: false, error: "Master CV configuration is unavailable" };
  }
  if (!fileStat.isFile()) {
    return { ok: false, error: "Master CV configuration is unavailable" };
  }
  if (isWorldReadable(fileStat.mode)) {
    return { ok: false, error: "Master CV configuration is unavailable" };
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { ok: false, error: "Master CV configuration is unavailable" };
  }

  return parseAndValidate(raw, "path");
}

async function resolveMasterCvAsync(): Promise<MasterCvLoadResult> {
  const envBody = getEnvString("MASTER_CV_JSON")?.trim();
  if (envBody) {
    return loadFromEnvBody(envBody);
  }
  const path = getEnvString("MASTER_CV_PATH")?.trim();
  if (path) {
    return loadFromPathAsync(path);
  }
  return { ok: false, error: "Master CV configuration is unavailable" };
}

function resolveMasterCvSync(): MasterCvLoadResult {
  const envBody = getEnvString("MASTER_CV_JSON")?.trim();
  if (envBody) {
    return loadFromEnvBody(envBody);
  }
  const path = getEnvString("MASTER_CV_PATH")?.trim();
  if (path) {
    return loadFromPathSync(path);
  }
  return { ok: false, error: "Master CV configuration is unavailable" };
}

/**
 * Async load at process startup. Must complete before requests are accepted
 * (called from `instrumentation.ts`).
 */
export async function preloadMasterCv(): Promise<MasterCvLoadResult> {
  const existing = getCachedResult();
  if (existing !== undefined) {
    return existing;
  }
  const result = await resolveMasterCvAsync();
  setCachedResult(result);
  return result;
}

/**
 * Resolve master CV (smoke CLI / tests). Caches on success or failure so
 * subsequent calls do not re-hit the filesystem.
 */
export function loadMasterCv(): MasterCvLoadResult {
  const existing = getCachedResult();
  if (existing !== undefined) {
    return existing;
  }
  const result = resolveMasterCvSync();
  setCachedResult(result);
  return result;
}

/**
 * Serve preloaded master for the HTTP request path. Never performs disk I/O.
 * Throws ServiceError when preload did not succeed (route maps to 503).
 */
export function requireMasterCv(): unknown {
  const cachedResult = getCachedResult();
  if (cachedResult === undefined) {
    throw new ServiceError("Master CV configuration is unavailable");
  }
  if (!cachedResult.ok) {
    throw new ServiceError(cachedResult.error);
  }
  return cachedResult.data;
}

/** Test-only: clear the in-memory master cache so tests can swap env config. */
export function __resetMasterCvCacheForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "__resetMasterCvCacheForTest is only available in the test environment"
    );
  }
  setCachedResult(undefined);
}
