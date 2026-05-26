import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

function parseInlineMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
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

/** ZIP magic bytes for a valid .docx (Office Open XML) */
export function isValidDocxBase64(base64: string): boolean {
  try {
    const buf = Buffer.from(base64, "base64");
    return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  } catch {
    return false;
  }
}
