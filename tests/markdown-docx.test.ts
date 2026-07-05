import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidDocxBase64,
  markdownToDocxBase64,
  markdownToParagraphs,
  parseInlineMarkdown,
} from "../app/api/lib/markdown-docx";

const SAMPLE_CV = `# Summary
- Full-stack engineer with measurable delivery impact

## Experience
### Example Corp
- Built React features used by 10k users

## Skills
- TypeScript, React, Node.js

## Projects
### Side Project
- Shipped MVP in 3 weeks
`;

describe("markdown-docx", () => {
  it("parses headings and bullets into paragraphs", () => {
    const paragraphs = markdownToParagraphs(SAMPLE_CV);
    assert.ok(paragraphs.length >= 6);
  });

  it("produces base64 that decodes to a valid docx zip", async () => {
    const base64 = await markdownToDocxBase64(SAMPLE_CV);
    assert.ok(isValidDocxBase64(base64));
    const buf = Buffer.from(base64, "base64");
    assert.ok(buf.length > 100);
  });

  it("handles bold inline markdown", async () => {
    const base64 = await markdownToDocxBase64(
      "# Summary\n- **Led** platform migration"
    );
    assert.ok(isValidDocxBase64(base64));
  });

  it("handles empty markdown without throwing", async () => {
    const base64 = await markdownToDocxBase64("");
    assert.ok(typeof base64 === "string" && base64.length > 0);
    assert.ok(isValidDocxBase64(base64));
  });

  it("handles whitespace-only markdown without throwing", async () => {
    const base64 = await markdownToDocxBase64("   \n\t  ");
    assert.ok(typeof base64 === "string" && base64.length > 0);
    assert.ok(isValidDocxBase64(base64));
  });

  it("isValidDocxBase64 returns false for empty string", () => {
    assert.equal(isValidDocxBase64(""), false);
  });

  it("isValidDocxBase64 returns false for non-base64 input", () => {
    assert.equal(isValidDocxBase64("this is not base64!!!"), false);
  });

  it("isValidDocxBase64 rejects a charset-invalid string that Buffer.from would silently truncate", () => {
    // Buffer.from(str, "base64") never throws — it truncates at the first
    // invalid character instead of rejecting the input. The real docx magic
    // bytes ("UEsDB...") followed by an invalid character must still be
    // rejected by the charset check, not silently accepted via truncation.
    assert.equal(isValidDocxBase64("UEsDB!!!invalid###chars"), false);
  });

  it("isValidDocxBase64 still returns true for a real base64-encoded docx buffer", async () => {
    const base64 = await markdownToDocxBase64(SAMPLE_CV);
    assert.equal(isValidDocxBase64(base64), true);
  });

  /** Extract the literal text content from a docx TextRun's internal XML tree. */
  function textRunContent(run: InstanceType<typeof import("docx").TextRun>): string {
    type XmlNode = { rootKey?: string; root?: unknown };
    const nodes = (run as unknown as { root: XmlNode[] }).root;
    const textNode = nodes.find((n) => n.rootKey === "w:t");
    const textNodeChildren = (textNode?.root as unknown[]) ?? [];
    return textNodeChildren.find((c): c is string => typeof c === "string") ?? "";
  }

  it("produces no empty bold TextRun for a pathological '****' input", () => {
    // "****" splits into an empty-content bold match ("**" + "" + "**").
    // Prior behavior pushed an empty-text bold TextRun; now it's skipped.
    const runs = parseInlineMarkdown("****");
    for (const run of runs) {
      assert.notEqual(textRunContent(run), "", "expected no empty-text runs");
    }
  });

  it("produces no empty TextRun for a lone unmatched '**' marker", () => {
    const runs = parseInlineMarkdown("**");
    for (const run of runs) {
      assert.notEqual(textRunContent(run), "", "expected no empty-text runs");
    }
  });

  it("handles a lone unmatched '**' marker without throwing", async () => {
    const base64 = await markdownToDocxBase64("Some **text");
    assert.ok(isValidDocxBase64(base64));
  });
});
