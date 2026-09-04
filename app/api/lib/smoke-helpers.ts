/**
 * Smoke helpers: redact-by-default artifacts.
 */
import { basename, join } from "node:path";
import type { CurationMode } from "./curation-mode";

/** Safe filesystem slug from a JD path (basename without its terminal extension). */
export function smokeArtifactSlug(jdPath: string): string {
  const base = basename(jdPath).replace(/\.[^.]+$/i, "");
  const slug = base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "jd";
}

/** Docx + curated JSON paths under the smoke output directory, named for the JD. */
export function smokeArtifactPaths(
  jdPath: string,
  smokeDir: string
): {
  slug: string;
  curatedPath: string;
  docxPath: string;
  coverLetterPath: string;
} {
  const slug = smokeArtifactSlug(jdPath);
  return {
    slug,
    curatedPath: join(smokeDir, `${slug}.curated.json`),
    docxPath: join(smokeDir, `${slug}.docx`),
    coverLetterPath: join(smokeDir, `${slug}.cover-letter.docx`),
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
