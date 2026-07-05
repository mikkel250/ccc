import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getAllContext, resetKnowledgeBaseCacheForTest } from "../app/api/lib/knowledge-base";
import { ServiceError } from "../app/api/lib/errors";

const REQUIRED_FILES = [
  "experience.md",
  "projects.md",
  "skills.md",
  "career-story.md",
  "meta-project.md",
] as const;

function mockKbFiles(
  overrides: Partial<Record<(typeof REQUIRED_FILES)[number], string | "ENOENT">>
): void {
  mock.method(fs, "readFileSync", (filePath: fs.PathOrFileDescriptor) => {
    const pathStr = String(filePath);
    for (const fileName of REQUIRED_FILES) {
      if (!pathStr.endsWith(fileName)) continue;
      const content = overrides[fileName];
      if (content === "ENOENT") {
        const err = new Error(`ENOENT: no such file, open '${pathStr}'`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      if (content !== undefined) {
        return content;
      }
      return `# ${fileName}\nDefault test content.`;
    }
    return "unexpected path";
  });
}

describe("getAllContext — KB fail-fast", () => {
  beforeEach(() => {
    resetKnowledgeBaseCacheForTest();
  });

  afterEach(() => {
    mock.restoreAll();
    resetKnowledgeBaseCacheForTest();
  });

  for (const missingFile of REQUIRED_FILES) {
    it(`throws ServiceError when ${missingFile} is missing`, () => {
      mockKbFiles({ [missingFile]: "ENOENT" });
      assert.throws(
        () => getAllContext(),
        (error: unknown) => {
          assert.equal(error instanceof ServiceError, true);
          assert.match(String((error as Error).message), new RegExp(missingFile));
          return true;
        }
      );
    });
  }

  it("throws ServiceError with empty-specific message when file is whitespace-only", () => {
    mockKbFiles({ "skills.md": "   \n\t  " });
    assert.throws(
      () => getAllContext(),
      (error: unknown) => {
        assert.equal(error instanceof ServiceError, true);
        assert.match(String((error as Error).message), /skills\.md is empty/);
        assert.doesNotMatch(String((error as Error).message), /missing or unreadable/);
        return true;
      }
    );
  });

  it("throws ServiceError with missing-specific message when file is unreadable", () => {
    mockKbFiles({ "skills.md": "ENOENT" });
    assert.throws(
      () => getAllContext(),
      (error: unknown) => {
        assert.equal(error instanceof ServiceError, true);
        assert.match(String((error as Error).message), /skills\.md is missing or unreadable/);
        assert.doesNotMatch(String((error as Error).message), /is empty/);
        return true;
      }
    );
  });

  it("throws ServiceError (not generic Error) when a required file is unreadable", () => {
    mockKbFiles({ "skills.md": "ENOENT" });
    assert.throws(() => getAllContext(), ServiceError);
  });

  it("returns joined content when all required files are present", () => {
    mockKbFiles({
      "experience.md": "# Experience\nBuilt platforms.",
      "projects.md": "# Projects\nSide projects.",
      "skills.md": "# Skills\nTypeScript.",
      "career-story.md": "# Story\nCareer pivot.",
      "meta-project.md": "# Meta\nThis API.",
    });
    const context = getAllContext();
    assert.match(context, /Built platforms/);
    assert.match(context, /Side projects/);
    assert.match(context, /TypeScript/);
    assert.match(context, /Career pivot/);
    assert.match(context, /This API/);
    assert.ok(context.includes("--"));
  });

  it("caches the joined KB across repeated calls (no fs reads on the second call)", () => {
    mockKbFiles({
      "experience.md": "# Experience\nBuilt platforms.",
      "projects.md": "# Projects\nSide projects.",
      "skills.md": "# Skills\nTypeScript.",
      "career-story.md": "# Story\nCareer pivot.",
      "meta-project.md": "# Meta\nThis API.",
    });

    const first = getAllContext();
    const readMock = fs.readFileSync as unknown as { mock: { callCount: () => number } };
    const callsAfterFirst = readMock.mock.callCount();
    assert.ok(callsAfterFirst >= 5, "first call reads every required KB file");

    const second = getAllContext();
    const callsAfterSecond = readMock.mock.callCount();
    assert.equal(second, first, "cached context matches");
    assert.equal(callsAfterSecond, callsAfterFirst, "second call performs zero fs reads");
  });
});
