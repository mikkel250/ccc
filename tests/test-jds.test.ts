import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const TEST_JDS_DIR = path.join(process.cwd(), "knowledge-base", "test-jds");
const GITIGNORE_PATH = path.join(process.cwd(), ".gitignore");

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE =
  /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const YAML_FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

function listTestJdFiles(): string[] {
  if (!fs.existsSync(TEST_JDS_DIR)) return [];
  return fs
    .readdirSync(TEST_JDS_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(TEST_JDS_DIR, name));
}

describe("knowledge-base/test-jds — test JD set", () => {
  it("contains at least 2 markdown JD files", () => {
    const files = listTestJdFiles();
    assert.ok(
      files.length >= 2,
      `expected at least 2 test JD files, found ${files.length}`
    );
  });

  it("contains at least 3 raw recruiter-text JD files", () => {
    const files = listTestJdFiles();
    assert.ok(
      files.length >= 3,
      `expected at least 3 test JD files for eval coverage, found ${files.length}`
    );
  });

  it("each JD file exists and is non-empty", () => {
    const files = listTestJdFiles();
    assert.ok(files.length > 0, "no test JD files found");
    for (const filePath of files) {
      const stat = fs.statSync(filePath);
      assert.ok(stat.isFile(), `${filePath} is not a file`);
      const content = fs.readFileSync(filePath, "utf-8");
      assert.ok(content.trim().length > 0, `${filePath} is empty`);
    }
  });

  it("each JD is raw recruiter text without YAML frontmatter delimiters", () => {
    const files = listTestJdFiles();
    assert.ok(files.length > 0, "no test JD files found");
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf-8");
      assert.ok(
        !YAML_FRONTMATTER_RE.test(content),
        `${filePath} must not include YAML frontmatter (--- delimiters at file start)`
      );
      assert.ok(
        !/^roleType:/m.test(content),
        `${filePath} must not include structured roleType metadata`
      );
      assert.ok(
        !/^sourceNote:/m.test(content),
        `${filePath} must not include structured sourceNote metadata`
      );
    }
  });

  it("contains no PII (emails, phone numbers, SSN patterns)", () => {
    const files = listTestJdFiles();
    assert.ok(files.length > 0, "no test JD files found");
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf-8");
      assert.ok(!EMAIL_RE.test(content), `${filePath} contains email-like PII`);
      assert.ok(!PHONE_RE.test(content), `${filePath} contains phone-like PII`);
      assert.ok(!SSN_RE.test(content), `${filePath} contains SSN-like PII`);
    }
  });

  it("each file has paragraph or list content suitable for raw recruiter text", () => {
    const files = listTestJdFiles();
    assert.ok(files.length > 0, "no test JD files found");
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf-8");
      const hasReadableContent = content
        .split("\n")
        .some((line) => line.trim().length > 20);
      assert.ok(
        hasReadableContent,
        `${filePath} must include substantive recruiter text (paragraphs or bullets)`
      );
    }
  });

  it("test-jds directory is not gitignored (files are committed)", () => {
    const gitignore = fs.readFileSync(GITIGNORE_PATH, "utf-8");
    const ignoredPatterns = gitignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const testJdsPatterns = [
      "knowledge-base/test-jds",
      "knowledge-base/test-jds/",
      "/knowledge-base/test-jds",
      "/knowledge-base/test-jds/",
      "test-jds/",
      "test-jds",
    ];
    for (const pattern of testJdsPatterns) {
      assert.ok(
        !ignoredPatterns.includes(pattern),
        `.gitignore must not ignore ${pattern} — test JDs are committed to the repo`
      );
    }
  });

  it("each filename slug is kebab-case and usable as eval-results key", () => {
    const files = listTestJdFiles();
    assert.ok(files.length > 0, "no test JD files found");
    for (const filePath of files) {
      const slug = path.basename(filePath, ".md");
      assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${slug} must be kebab-case`);
    }
  });
});
