/**
 * Stage 2 format scorer — sync check that generated CVs match the Struan 8-part structure.
 *
 * No LLM call: validates headings against FormatSection in eval-schema.ts.
 * Same structural contract enforced by cv-prompt.ts in production.
 */
import { FormatSection, type FormatScore } from "./eval-schema";

const CANONICAL_SECTIONS = Object.values(FormatSection);

function normalizeHeading(text: string): string {
  return text.trim().toLowerCase();
}

/** Extract CV section headings per cv-prompt contract: `##` sections; legacy `# Section` h1 also accepted. */
function extractTopLevelHeadings(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    // Match h1 or h2 only — `###`+ subheadings (company names, etc.) are intentionally excluded.
    const match = line.match(/^#{1,2}\s+(.+)$/);
    if (!match) continue;

    const title = match[1]!.trim();
    const isH2 = line.startsWith("##");
    const isLegacyH1Section = !isH2 && findCanonicalIndex(title) >= 0;
    if (isH2 || isLegacyH1Section) {
      headings.push(title);
    }
  }
  return headings;
}

function findCanonicalIndex(heading: string): number {
  const normalized = normalizeHeading(heading);
  return CANONICAL_SECTIONS.findIndex(
    (section) => normalizeHeading(section) === normalized
  );
}

/**
 * Pure synchronous format compliance checker for the 8-part Struan CV structure.
 */
export function scoreFormatCompliance(cvMarkdown: string): FormatScore {
  const breakdown: Record<string, boolean> = {};
  for (const section of CANONICAL_SECTIONS) {
    breakdown[section] = false;
  }

  const details: string[] = [];

  if (!cvMarkdown.trim()) {
    details.push("Empty CV input");
    return { score: 0.0, breakdown, details };
  }

  const headings = extractTopLevelHeadings(cvMarkdown);

  if (headings.length === 0) {
    details.push("No top-level markdown headings found");
    return { score: 0.0, breakdown, details };
  }

  const matchedIndices: number[] = [];
  const extras: string[] = [];

  for (const heading of headings) {
    const idx = findCanonicalIndex(heading);
    if (idx >= 0) {
      breakdown[CANONICAL_SECTIONS[idx]!] = true;
      matchedIndices.push(idx);
    } else {
      extras.push(heading);
    }
  }

  const presentCount = CANONICAL_SECTIONS.filter((s) => breakdown[s]).length;

  let orderOk = true;
  if (matchedIndices.length >= 2) {
    for (let i = 1; i < matchedIndices.length; i++) {
      if (matchedIndices[i]! < matchedIndices[i - 1]!) {
        orderOk = false;
        break;
      }
    }
  }

  if (!orderOk) {
    details.push("Sections present but out of prescribed order");
  }

  for (const section of CANONICAL_SECTIONS) {
    if (!breakdown[section]) {
      details.push(`Missing section: ${section}`);
    }
  }

  if (extras.length > 0) {
    details.push(
      `Unexpected extra sections: ${extras.join(", ")}`
    );
  }

  let score = presentCount / CANONICAL_SECTIONS.length;

  if (!orderOk && presentCount > 0) {
    score *= 0.9;
  }

  if (extras.length > 0) {
    score *= CANONICAL_SECTIONS.length / (CANONICAL_SECTIONS.length + extras.length);
  }

  score = Math.max(0, Math.min(1, score));

  return { score, breakdown, details };
}
