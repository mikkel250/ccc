import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ServiceError } from "../app/api/lib/errors";
import {
  __resetMasterCvCacheForTest,
  requireMasterCv,
} from "../app/api/lib/master-cv";
import { inboxScanCliExitCode, runInboxScanCli } from "../scripts/inbox-scan";

const validCv = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/curated-cv-valid.json"), "utf8")
) as unknown;

describe("inboxScanCliExitCode", () => {
  it("is 0 when every item succeeded or was skipped", () => {
    assert.equal(
      inboxScanCliExitCode({
        ok: true,
        items: [
          { messageId: "a", status: "drafted" },
          { messageId: "b", status: "skipped-processed" },
          { messageId: "c", status: "reused-draft" },
        ],
      }),
      0
    );
  });

  it("is 1 when the library scan itself failed", () => {
    assert.equal(inboxScanCliExitCode({ ok: false, error: "gmail down" }), 1);
  });

  it("is 1 when any item is tailor-failed, draft-failed, or fetch-failed", () => {
    assert.equal(
      inboxScanCliExitCode({
        ok: true,
        items: [
          { messageId: "a", status: "drafted" },
          { messageId: "b", status: "tailor-failed" },
        ],
      }),
      1
    );
    assert.equal(
      inboxScanCliExitCode({
        ok: true,
        items: [{ messageId: "c", status: "draft-failed" }],
      }),
      1
    );
    assert.equal(
      inboxScanCliExitCode({
        ok: true,
        items: [{ messageId: "d", status: "fetch-failed" }],
      }),
      1
    );
  });
});

describe("runInboxScanCli master CV preload", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "MASTER_CV_JSON",
    "MASTER_CV_PATH",
    "GMAIL_REFRESH_TOKEN",
    "INBOX_SCAN_ENABLED",
  ] as const;

  beforeEach(() => {
    __resetMasterCvCacheForTest();
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    __resetMasterCvCacheForTest();
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("fills the cache before scan so requireMasterCv can serve the master", async () => {
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    process.env.INBOX_SCAN_ENABLED = "1";
    await assert.rejects(
      () => runInboxScanCli(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceError);
        assert.match(error.message, /GMAIL_REFRESH_TOKEN/);
        return true;
      }
    );
    assert.deepEqual(requireMasterCv(), validCv);
  });

  it("returns the master CV error and does not scan when preload fails", async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("inbox scan test must not call fetch");
    };
    try {
      const result = await runInboxScanCli();
      assert.deepEqual(result, {
        ok: false,
        error: "Master CV configuration is unavailable",
      });
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
