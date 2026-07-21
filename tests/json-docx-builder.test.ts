import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  BUILDER_VERSION,
  buildJsonDocx,
  buildJsonDocxBase64,
  sanitizeCvText,
  sanitizeCvJson,
} from "../app/api/lib/json-docx-builder";

const FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/curated-cv-valid.json"), "utf8")
) as unknown;

function isDocxZip(buf: Buffer): boolean {
  return buf.length > 100 && buf[0] === 0x50 && buf[1] === 0x4b;
}

describe("json-docx-builder", () => {
  it("exports a stable BUILDER_VERSION", () => {
    assert.match(BUILDER_VERSION, /^\d+\.\d+\.\d+/);
  });

  it("strips disallowed control characters from free text", () => {
    assert.equal(sanitizeCvText("ok\tline\nkeep"), "ok\tline\nkeep");
    assert.equal(sanitizeCvText("bad\u0000\u0001\u0007text\u007F"), "badtext");
  });

  it("sanitizes string leaves recursively", () => {
    const dirty = {
      name: "A\u0000B",
      nested: { items: "x\u0001y" },
      list: ["p\u0007q"],
    };
    assert.deepEqual(sanitizeCvJson(dirty), {
      name: "AB",
      nested: { items: "xy" },
      list: ["pq"],
    });
  });

  it("builds a non-empty docx buffer from fixture curated JSON", async () => {
    const result = await buildJsonDocx(FIXTURE);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.builderVersion, BUILDER_VERSION);
    assert.ok(isDocxZip(result.buffer));
  });

  it("returns base64 that decodes to a docx zip", async () => {
    const result = await buildJsonDocxBase64(FIXTURE);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const buf = Buffer.from(result.base64, "base64");
    assert.ok(isDocxZip(buf));
  });

  it("round-trips rebuild with the same builder version", async () => {
    const first = await buildJsonDocx(FIXTURE);
    const second = await buildJsonDocx(FIXTURE);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.builderVersion, second.builderVersion);
    assert.ok(first.buffer.length > 0);
    assert.ok(second.buffer.length > 0);
  });

  it("rejects non-object input", async () => {
    const result = await buildJsonDocx(null);
    assert.equal(result.ok, false);
  });
});

describe("regen-docx CLI", () => {
  it("writes docx when versions match", () => {
    const dir = mkdtempSync(join(tmpdir(), "regen-docx-"));
    const out = join(dir, "out.docx");
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/regen-docx.ts",
          "tests/fixtures/curated-cv-valid.json",
          out,
          `--builder-version=${BUILDER_VERSION}`,
        ],
        { cwd: process.cwd(), encoding: "utf8" }
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.ok(existsSync(out));
      assert.ok(isDocxZip(readFileSync(out)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits non-zero and writes nothing on version mismatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "regen-docx-mismatch-"));
    const out = join(dir, "out.docx");
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/regen-docx.ts",
          "tests/fixtures/curated-cv-valid.json",
          out,
          "--builder-version=0.0.0-not-real",
        ],
        { cwd: process.cwd(), encoding: "utf8" }
      );
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(out), false);
      assert.match(result.stderr || result.stdout, /version mismatch/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
