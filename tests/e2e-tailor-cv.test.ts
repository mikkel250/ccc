import { describe, it, afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { markdownToDocxBase64 } from "../app/api/lib/markdown-docx";
import { __resetMasterCvCacheForTest } from "../app/api/lib/master-cv";
import {
  resolveCurationMode,
  writeSmokeArtifacts,
  runSmokeCli,
} from "../scripts/e2e-tailor-cv";

const CURATED = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/curated-cv-valid.json"),
    "utf8"
  )
) as Record<string, unknown>;

describe("resolveCurationMode", () => {
  it("returns strict when SMOKE_CURATION_MODE=strict and flexible flag is absent", () => {
    assert.equal(resolveCurationMode(false, "strict"), "strict");
  });

  it("returns flexible when SMOKE_CURATION_MODE=flexible", () => {
    assert.equal(resolveCurationMode(false, "flexible"), "flexible");
  });

  it("returns flexible when --flexible is passed regardless of env", () => {
    assert.equal(resolveCurationMode(true, "strict"), "flexible");
  });

  it("throws on malformed SMOKE_CURATION_MODE", () => {
    assert.throws(
      () => resolveCurationMode(false, "loose"),
      /SMOKE_CURATION_MODE must be "strict" or "flexible"/
    );
  });
});

describe("writeSmokeArtifacts", () => {
  let dir: string;
  const prevUnredacted = process.env.SMOKE_WRITE_UNREDACTED;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "smoke-artifacts-"));
    delete process.env.SMOKE_WRITE_UNREDACTED;
  });

  afterEach(() => {
    if (prevUnredacted === undefined) {
      delete process.env.SMOKE_WRITE_UNREDACTED;
    } else {
      process.env.SMOKE_WRITE_UNREDACTED = prevUnredacted;
    }
    rmSync(dir, { recursive: true, force: true });
    mock.restoreAll();
  });

  it("writes curated JSON and DOCX on success", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const paths = await writeSmokeArtifacts({
      jdPath: "/tmp/acme-se.md",
      curated: CURATED,
      builderVersion: "v1",
      cvBase64: docx,
      curationMode: "strict",
      coverLetter: undefined,
      artifactDir: dir,
    });
    assert.ok(existsSync(paths.curatedPath));
    assert.ok(existsSync(paths.docxPath));
    const payload = JSON.parse(readFileSync(paths.curatedPath, "utf8")) as {
      redacted: boolean;
      curatedJson: { contact?: { redacted?: boolean }; summary?: string[] };
    };
    assert.equal(payload.redacted, true);
    assert.equal(payload.curatedJson.contact?.redacted, true);
    assert.ok(
      Array.isArray(payload.curatedJson.summary) &&
        payload.curatedJson.summary.every((s) => s === "[REDACTED]")
    );
  });

  it("writes unredacted curated JSON when SMOKE_WRITE_UNREDACTED=1", async () => {
    process.env.SMOKE_WRITE_UNREDACTED = "1";
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const paths = await writeSmokeArtifacts({
      jdPath: "/tmp/acme-se.md",
      curated: CURATED,
      builderVersion: "v1",
      cvBase64: docx,
      curationMode: "strict",
      coverLetter: undefined,
      artifactDir: dir,
    });
    const payload = JSON.parse(readFileSync(paths.curatedPath, "utf8")) as {
      redacted: boolean;
      curatedJson: { summary?: string[] };
    };
    assert.equal(payload.redacted, false);
    assert.deepEqual(payload.curatedJson.summary, CURATED.summary);
  });

  it("writes cover-letter DOCX in flexible mode", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const paths = await writeSmokeArtifacts({
      jdPath: "/tmp/acme-se.md",
      curated: CURATED,
      builderVersion: "v1",
      cvBase64: docx,
      curationMode: "flexible",
      coverLetter: "Dear hiring team,\n\nI am excited.",
      artifactDir: dir,
    });
    assert.ok(existsSync(paths.coverLetterPath));
    const buf = readFileSync(paths.coverLetterPath);
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4b);
  });

  it("surfaces write failures for curated JSON", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const blocked = join(dir, "blocked");
    writeFileSync(blocked, "not-a-dir");
    await assert.rejects(
      () =>
        writeSmokeArtifacts({
          jdPath: "/tmp/acme-se.md",
          curated: CURATED,
          builderVersion: "v1",
          cvBase64: docx,
          curationMode: "strict",
          coverLetter: undefined,
          artifactDir: blocked,
        }),
      /EEXIST|ENOTDIR|ENOTSUP|EACCES|EPERM|ENOENT|EISDIR|ENOSPC/
    );
  });

  it("surfaces permission-denied write failures", async () => {
    if (process.platform === "win32") return;
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const readonlyDir = mkdtempSync(join(tmpdir(), "smoke-ro-"));
    try {
      chmodSync(readonlyDir, 0o555);
      await assert.rejects(
        () =>
          writeSmokeArtifacts({
            jdPath: "/tmp/acme-se.md",
            curated: CURATED,
            builderVersion: "v1",
            cvBase64: docx,
            curationMode: "strict",
            coverLetter: undefined,
            artifactDir: readonlyDir,
          }),
        /EACCES|EPERM/
      );
    } finally {
      chmodSync(readonlyDir, 0o755);
      rmSync(readonlyDir, { recursive: true, force: true });
    }
  });
});

describe("runSmokeCli exit codes", () => {
  const prevKey = process.env.TAILOR_API_KEY;
  const prevMaster = process.env.MASTER_CV_JSON;
  const prevGroundingMin = process.env.SMOKE_GROUNDING_MIN;
  const prevJdFitMin = process.env.SMOKE_JD_FIT_MIN;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "smoke-cli-"));
    process.env.TAILOR_API_KEY = "test-key";
    process.env.MASTER_CV_JSON = JSON.stringify(CURATED);
    process.env.SMOKE_GROUNDING_MIN = "0.7";
    process.env.SMOKE_JD_FIT_MIN = "3";
    __resetMasterCvCacheForTest();
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.TAILOR_API_KEY;
    else process.env.TAILOR_API_KEY = prevKey;
    if (prevMaster === undefined) delete process.env.MASTER_CV_JSON;
    else process.env.MASTER_CV_JSON = prevMaster;
    if (prevGroundingMin === undefined) delete process.env.SMOKE_GROUNDING_MIN;
    else process.env.SMOKE_GROUNDING_MIN = prevGroundingMin;
    if (prevJdFitMin === undefined) delete process.env.SMOKE_JD_FIT_MIN;
    else process.env.SMOKE_JD_FIT_MIN = prevJdFitMin;
    __resetMasterCvCacheForTest();
    rmSync(dir, { recursive: true, force: true });
    mock.restoreAll();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("exits 1 on health failure", async () => {
    writeFileSync(join(dir, "jd.md"), "Need a solutions engineer");
    const exits: number[] = [];
    const exitMock = mock.method(process, "exit", ((code?: number) => {
      exits.push(code ?? 0);
      throw new Error(`process.exit(${code ?? 0})`);
    }) as typeof process.exit);

    await assert.rejects(
      () =>
        runSmokeCli({
          baseUrl: "http://localhost:3000",
          jdPath: join(dir, "jd.md"),
          wantFlexible: false,
          artifactDir: dir,
          deps: {
            fetchFn: async () => jsonResponse({ status: "down" }),
            scoreJsonGrounding: async () => ({
              score: 1,
              flaggedClaims: [],
              parseFailed: false,
            }),
            scoreJsonJdFit: async () => ({
              score: 5,
              reasoning: "ok",
              parseFailed: false,
            }),
          },
        }),
      /process\.exit\(1\)/
    );
    assert.deepEqual(exits, [1]);
    assert.equal(exitMock.mock.callCount(), 1);
  });

  it("exits 1 on tailor failure", async () => {
    writeFileSync(join(dir, "jd.md"), "Need a solutions engineer");
    const exits: number[] = [];
    mock.method(process, "exit", ((code?: number) => {
      exits.push(code ?? 0);
      throw new Error(`process.exit(${code ?? 0})`);
    }) as typeof process.exit);

    await assert.rejects(
      () =>
        runSmokeCli({
          baseUrl: "http://localhost:3000",
          jdPath: join(dir, "jd.md"),
          wantFlexible: false,
          artifactDir: dir,
          deps: {
            fetchFn: async (input: RequestInfo | URL) => {
              const url = String(input);
              if (url.endsWith("/api/hello")) {
                return jsonResponse({ status: "ok" });
              }
              return jsonResponse({ error: "boom" }, 500);
            },
            scoreJsonGrounding: async () => ({
              score: 1,
              flaggedClaims: [],
              parseFailed: false,
            }),
            scoreJsonJdFit: async () => ({
              score: 5,
              reasoning: "ok",
              parseFailed: false,
            }),
          },
        }),
      /process\.exit\(1\)/
    );
    assert.deepEqual(exits, [1]);
  });

  it("exits 1 on docx failure", async () => {
    writeFileSync(join(dir, "jd.md"), "Need a solutions engineer");
    const exits: number[] = [];
    mock.method(process, "exit", ((code?: number) => {
      exits.push(code ?? 0);
      throw new Error(`process.exit(${code ?? 0})`);
    }) as typeof process.exit);

    await assert.rejects(
      () =>
        runSmokeCli({
          baseUrl: "http://localhost:3000",
          jdPath: join(dir, "jd.md"),
          wantFlexible: false,
          artifactDir: dir,
          deps: {
            fetchFn: async (input: RequestInfo | URL) => {
              const url = String(input);
              if (url.endsWith("/api/hello")) {
                return jsonResponse({ status: "ok" });
              }
              return jsonResponse({
                cv: Buffer.from("nope").toString("base64"),
                curatedJson: CURATED,
                builderVersion: "v1",
                model: "test/model",
              });
            },
            scoreJsonGrounding: async () => ({
              score: 1,
              flaggedClaims: [],
              parseFailed: false,
            }),
            scoreJsonJdFit: async () => ({
              score: 5,
              reasoning: "ok",
              parseFailed: false,
            }),
          },
        }),
      /process\.exit\(1\)/
    );
    assert.deepEqual(exits, [1]);
  });

  it("exits 1 when smoke gates fail", async () => {
    writeFileSync(join(dir, "jd.md"), "Need a solutions engineer");
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const exits: number[] = [];
    mock.method(process, "exit", ((code?: number) => {
      exits.push(code ?? 0);
      throw new Error(`process.exit(${code ?? 0})`);
    }) as typeof process.exit);

    await assert.rejects(
      () =>
        runSmokeCli({
          baseUrl: "http://localhost:3000",
          jdPath: join(dir, "jd.md"),
          wantFlexible: false,
          artifactDir: dir,
          deps: {
            fetchFn: async (input: RequestInfo | URL) => {
              const url = String(input);
              if (url.endsWith("/api/hello")) {
                return jsonResponse({ status: "ok" });
              }
              return jsonResponse({
                cv: docx,
                curatedJson: CURATED,
                builderVersion: "v1",
                model: "test/model",
              });
            },
            scoreJsonGrounding: async () => ({
              score: 0.1,
              flaggedClaims: ["bad claim"],
              parseFailed: false,
            }),
            scoreJsonJdFit: async () => ({
              score: 1,
              reasoning: "weak",
              parseFailed: false,
            }),
          },
        }),
      /process\.exit\(1\)/
    );
    assert.deepEqual(exits, [1]);
  });

  it("exits 0 on full success", async () => {
    writeFileSync(join(dir, "jd.md"), "Need a solutions engineer");
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const exits: number[] = [];
    mock.method(process, "exit", ((code?: number) => {
      exits.push(code ?? 0);
      throw new Error(`process.exit(${code ?? 0})`);
    }) as typeof process.exit);

    await assert.rejects(
      () =>
        runSmokeCli({
          baseUrl: "http://localhost:3000",
          jdPath: join(dir, "jd.md"),
          wantFlexible: false,
          artifactDir: dir,
          deps: {
            fetchFn: async (input: RequestInfo | URL) => {
              const url = String(input);
              if (url.endsWith("/api/hello")) {
                return jsonResponse({ status: "ok" });
              }
              return jsonResponse({
                cv: docx,
                curatedJson: CURATED,
                builderVersion: "v1",
                model: "test/model",
              });
            },
            scoreJsonGrounding: async () => ({
              score: 0.95,
              flaggedClaims: [],
              parseFailed: false,
            }),
            scoreJsonJdFit: async () => ({
              score: 5,
              reasoning: "strong",
              parseFailed: false,
            }),
          },
        }),
      /process\.exit\(0\)/
    );
    assert.deepEqual(exits, [0]);
    assert.ok(existsSync(join(dir, "jd.curated.json")));
    assert.ok(existsSync(join(dir, "jd.docx")));
  });
});
