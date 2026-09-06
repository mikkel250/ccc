/**
 * Smoke helpers: redact-by-default artifacts.
 */
import { basename, join } from "node:path";
import { getSmokeParityModelsCsv } from "../../../lib/env";
import { KNOWN_PROVIDERS, type Provider } from "../../../lib/providers";
import type { CurationMode } from "./curation-mode";

/**
 * Same namespaced-model rules as `detectProvider` in llm.ts, without importing
 * that module (it pulls provider SDKs). Used by the parity catalog parser.
 */
function assertNamespacedModel(model: string): void {
  const slash = model.indexOf("/");
  if (slash === -1) {
    throw new Error(
      `Invalid model string "${model}": must be namespaced as provider/model`
    );
  }
  const providerSegment = model.slice(0, slash);
  if (!KNOWN_PROVIDERS.has(providerSegment as Provider)) {
    throw new Error(
      `Unknown provider "${providerSegment}" in model "${model}"`
    );
  }
  const segments = model.split("/");
  if (segments.some((part) => part === "" || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error(
      `Invalid model string "${model}": must be namespaced as provider/model`
    );
  }
}

/** Safe filesystem slug from a JD path (basename without its terminal extension). */
export function smokeArtifactSlug(jdPath: string): string {
  const base = basename(jdPath).replace(/\.[^.]+$/i, "");
  const slug = base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "jd";
}

/** Nest smoke artifacts under `<root>/<provider>/<model>/…` (eval-results shape). */
export function smokeParityArtifactDir(root: string, model: string): string {
  assertNamespacedModel(model);
  return join(root, ...model.split("/"));
}

/**
 * Parse `SMOKE_PARITY_MODELS` CSV. Omit `csv` to read env (default catalog).
 * Bare aliases and unknown providers throw.
 */
export function parseSmokeParityModels(csv?: string): string[] {
  const raw = csv === undefined ? getSmokeParityModelsCsv() : csv;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error("SMOKE_PARITY_MODELS is empty");
  }
  for (const model of parts) {
    assertNamespacedModel(model);
  }
  return parts;
}

export type ParityCellStatus = { ok: boolean };

export type ParityStatus = {
  cells: Record<string, ParityCellStatus>;
};

/** Last-write-wins per model key. Catalog is unused here; callers compute pending separately. */
export function mergeParityStatus(
  existing: ParityStatus | null | undefined,
  catalog: readonly string[],
  model: string,
  ok: boolean
): ParityStatus {
  void catalog;
  return {
    cells: {
      ...(existing?.cells ?? {}),
      [model]: { ok },
    },
  };
}

function recordFromObject(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    out[key] = Reflect.get(value, key);
  }
  return out;
}

/** Validate on-disk `parity-status.json` (external JSON is unknown until this runs). */
export function parseParityStatusJson(raw: unknown): ParityStatus {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid parity-status.json");
  }
  const root = recordFromObject(raw);
  const cellsRaw = root.cells;
  if (cellsRaw === null || typeof cellsRaw !== "object" || Array.isArray(cellsRaw)) {
    throw new Error("Invalid parity-status.json");
  }
  const cells: Record<string, ParityCellStatus> = {};
  for (const [key, cell] of Object.entries(recordFromObject(cellsRaw))) {
    if (cell === null || typeof cell !== "object" || Array.isArray(cell)) {
      throw new Error("Invalid parity-status.json");
    }
    const ok = recordFromObject(cell).ok;
    if (typeof ok !== "boolean") {
      throw new Error("Invalid parity-status.json");
    }
    cells[key] = { ok };
  }
  return { cells };
}

/** Catalog models that do not yet have an ok cell. */
export function pendingParityModels(
  catalog: readonly string[],
  status: ParityStatus
): string[] {
  return catalog.filter((model) => status.cells[model]?.ok !== true);
}

/** Docx + curated JSON paths under the smoke output directory, named for the JD. */
export function smokeArtifactPaths(
  jdPath: string,
  smokeDir: string,
  model?: string
): {
  slug: string;
  curatedPath: string;
  docxPath: string;
  coverLetterPath: string;
} {
  const slug = smokeArtifactSlug(jdPath);
  const dir = model ? smokeParityArtifactDir(smokeDir, model) : smokeDir;
  return {
    slug,
    curatedPath: join(dir, `${slug}.curated.json`),
    docxPath: join(dir, `${slug}.docx`),
    coverLetterPath: join(dir, `${slug}.cover-letter.docx`),
  };
}

/**
 * Pure predicate: should we attempt a cover-letter DOCX write?
 * True only for flexible mode with a non-empty trimmed string.
 */
export function shouldWriteCoverLetterDocx(
  curationMode: CurationMode,
  coverLetter: unknown
): coverLetter is string {
  return (
    curationMode === "flexible" &&
    typeof coverLetter === "string" &&
    coverLetter.trim().length > 0
  );
}

/** Strip contact + free-text bullets for default local artifact writes. */
export function redactCuratedForArtifact(curated: unknown): unknown {
  if (curated === null || typeof curated !== "object") return curated;
  const src = curated as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  if (src.contact && typeof src.contact === "object") {
    out.contact = { redacted: true };
  }
  if (Array.isArray(src.summary)) {
    out.summary = src.summary.map(() => "[REDACTED]");
  }
  if (Array.isArray(src.experience)) {
    out.experience = src.experience.map((role) => {
      if (!role || typeof role !== "object") return role;
      const r = role as Record<string, unknown>;
      return {
        ...r,
        blurb: r.blurb != null ? "[REDACTED]" : r.blurb,
        bullets: Array.isArray(r.bullets)
          ? r.bullets.map(() => "[REDACTED]")
          : r.bullets,
        subroles: Array.isArray(r.subroles)
          ? r.subroles.map((sr) => {
              if (!sr || typeof sr !== "object") return sr;
              const s = sr as Record<string, unknown>;
              return {
                ...s,
                bullets: Array.isArray(s.bullets)
                  ? s.bullets.map(() => "[REDACTED]")
                  : s.bullets,
              };
            })
          : r.subroles,
      };
    });
  }
  if (Array.isArray(src.projects)) {
    out.projects = src.projects.map((p) => {
      if (!p || typeof p !== "object") return p;
      const proj = p as Record<string, unknown>;
      return {
        ...proj,
        bullets: Array.isArray(proj.bullets)
          ? proj.bullets.map(() => "[REDACTED]")
          : proj.bullets,
      };
    });
  }
  return out;
}
