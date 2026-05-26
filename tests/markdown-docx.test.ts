import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidDocxBase64,
  markdownToDocxBase64,
  markdownToParagraphs,
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
});
