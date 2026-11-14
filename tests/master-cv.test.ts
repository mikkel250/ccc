import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  chmodSync,
  mkdtempSync,
  rmSync,
  promises as fsPromises,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadMasterCv,
  preloadMasterCv,
  requireMasterCv,
  __resetMasterCvCacheForTest,
  type MasterCvLoadResult,
} from "../app/api/lib/master-cv";
import { ServiceError } from "../app/api/lib/errors";

const fixturePath = join(process.cwd(), "tests/fixtures/curated-cv-valid.json");
const validCv = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

describe("loadMasterCv", () => {
  const savedJson = process.env.MASTER_CV_JSON;
  const savedPath = process.env.MASTER_CV_PATH;
  let tempDir: string | undefined;

  beforeEach(() => {
    __resetMasterCvCacheForTest();
    delete process.env.MASTER_CV_JSON;
    delete process.env.MASTER_CV_PATH;
  });

  afterEach(() => {
    if (savedJson === undefined) delete process.env.MASTER_CV_JSON;
    else process.env.MASTER_CV_JSON = savedJson;
    if (savedPath === undefined) delete process.env.MASTER_CV_PATH;
    else process.env.MASTER_CV_PATH = savedPath;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("loads valid MASTER_CV_JSON", () => {
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    const result = loadMasterCv();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "env");
    }
  });

  it("loads from a non-world-readable path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "master-cv-"));
    const path = join(tempDir, "master.json");
    writeFileSync(path, JSON.stringify(validCv), { mode: 0o600 });
    chmodSync(path, 0o600);
    process.env.MASTER_CV_PATH = path;
    const result = loadMasterCv();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "path");
    }
  });

  it("fails closed for world-readable master path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "master-cv-"));
    const path = join(tempDir, "master.json");
    writeFileSync(path, JSON.stringify(validCv));
    chmodSync(path, 0o644);
    process.env.MASTER_CV_PATH = path;
    const result = loadMasterCv();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /unavailable/i);
    }
  });

  it("fails closed when neither env nor path is set", () => {
    const result = loadMasterCv();
    assert.equal(result.ok, false);
  });

  it("prefers MASTER_CV_JSON over MASTER_CV_PATH", () => {
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    process.env.MASTER_CV_PATH = "/nonexistent/master.json";
    const result = loadMasterCv();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "env");
    }
  });

  it("preloadMasterCv caches for requireMasterCv without further disk reads", async () => {
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    const pre = await preloadMasterCv();
    assert.equal(pre.ok, true);
    const data = requireMasterCv();
    assert.equal(typeof data, "object");
  });

  it("preloadMasterCv path branch succeeds for non-world-readable file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "master-cv-preload-"));
    const path = join(tempDir, "master.json");
    writeFileSync(path, JSON.stringify(validCv), { mode: 0o600 });
    chmodSync(path, 0o600);
    process.env.MASTER_CV_PATH = path;
    delete process.env.MASTER_CV_JSON;

    const pre = await preloadMasterCv();
    assert.equal(pre.ok, true);
    if (pre.ok) {
      assert.equal(pre.source, "path");
    }
    const data = requireMasterCv();
    assert.equal(typeof data, "object");
    assert.deepEqual(data, validCv);
  });

  it("preloadMasterCv path branch rejects world-readable file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "master-cv-preload-world-"));
    const path = join(tempDir, "master.json");
    writeFileSync(path, JSON.stringify(validCv));
    chmodSync(path, 0o644);
    process.env.MASTER_CV_PATH = path;
    delete process.env.MASTER_CV_JSON;

    const pre = await preloadMasterCv();
    assert.equal(pre.ok, false);
    if (!pre.ok) {
      assert.match(pre.error, /unavailable/i);
    }
    assert.throws(() => requireMasterCv(), ServiceError);
  });

  it("requireMasterCv throws when nothing was preloaded", () => {
    assert.throws(() => requireMasterCv(), ServiceError);
  });

  it("concurrent preloadMasterCv calls share one path read", { timeout: 2000 }, async () => {
    tempDir = mkdtempSync(join(tmpdir(), "master-cv-preload-shared-"));
    const path = join(tempDir, "master.json");
    writeFileSync(path, JSON.stringify(validCv), { mode: 0o600 });
    chmodSync(path, 0o600);
    process.env.MASTER_CV_PATH = path;
    delete process.env.MASTER_CV_JSON;

    let opens = 0;
    let releaseOpen: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    const realOpen = fsPromises.open.bind(fsPromises);
    mock.method(
      fsPromises,
      "open",
      async (...args: Parameters<typeof fsPromises.open>) => {
        opens += 1;
        await gate;
        return realOpen(...args);
      }
    );

    try {
      const first = preloadMasterCv();
      const second = preloadMasterCv();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(opens, 1);
      releaseOpen();
      const [a, b] = await Promise.all([first, second]);
      assert.equal(a.ok, true);
      assert.deepEqual(a, b);
    } finally {
      releaseOpen();
      mock.restoreAll();
    }
  });

  it("preload cache is visible on globalThis for cross-bundle sharing", async () => {
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    const pre = await preloadMasterCv();
    assert.equal(pre.ok, true);

    const cacheKey =
      process.env.MASTER_CV_CACHE_KEY?.trim() || "__cccMasterCvCache";
    const replacement: MasterCvLoadResult = {
      ok: true,
      data: { name: "CROSS_BUNDLE_REPLACEMENT" },
      source: "env",
    };
    Reflect.set(globalThis, cacheKey, replacement);

    assert.equal(requireMasterCv(), replacement.data);
  });
});
