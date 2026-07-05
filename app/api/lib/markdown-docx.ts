/**
 * Converts LLM markdown output into the consumer-facing deliverable.
 *
 * The CCC app expects base64-encoded .docx, not raw markdown. This is the last
 * transformation before `route.ts` returns JSON. Supports headings, bullets, bold.
 */
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

/** Exported for direct unit testing of the bold-run split logic. */
export function parseInlineMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) {
      const boldText = part.slice(2, -2);
      if (boldText) runs.push(new TextRun({ text: boldText, bold: true }));
    } else {
      runs.push(new TextRun({ text: part }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
}

function headingLevel(line: string): (typeof HeadingLevel)[keyof typeof HeadingLevel] | null {
  if (line.startsWith("### ")) return HeadingLevel.HEADING_3;
  if (line.startsWith("## ")) return HeadingLevel.HEADING_2;
  if (line.startsWith("# ")) return HeadingLevel.HEADING_1;
  return null;
}

function headingText(line: string): string {
  return line.replace(/^#+\s+/, "").trim();
}

export function markdownToParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const level = headingLevel(line);
    if (level) {
      paragraphs.push(
        new Paragraph({
          text: headingText(line),
          heading: level,
        })
      );
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineMarkdown(bulletMatch[1]),
          bullet: { level: 0 },
        })
      );
      continue;
    }

    paragraphs.push(
      new Paragraph({
        children: parseInlineMarkdown(line),
      })
    );
  }

  return paragraphs;
}

export async function markdownToDocxBase64(markdown: string): Promise<string> {
  const children = markdownToParagraphs(markdown);
  const doc = new Document({
    sections: [
      {
        children:
          children.length > 0
            ? children
            : [new Paragraph({ text: "CV content unavailable" })],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer.toString("base64");
}

// Buffer.from(str, "base64") never throws on malformed input — it silently
// truncates at the first invalid character instead. A real charset check is
// needed to reject non-base64 strings rather than a try/catch that never fires.
const BASE64_CHARSET = /^[A-Za-z0-9+/]*={0,2}$/;

/** ZIP magic bytes for a valid .docx (Office Open XML) */
export function isValidDocxBase64(base64: string): boolean {
  if (!base64 || !BASE64_CHARSET.test(base64)) return false;
  const buf = Buffer.from(base64, "base64");
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}
