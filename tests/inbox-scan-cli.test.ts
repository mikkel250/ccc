import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inboxScanCliExitCode } from "../scripts/inbox-scan";

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

  it("is 1 when any item is tailor-failed or draft-failed", () => {
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
  });
});
