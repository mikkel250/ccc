import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withDeadline } from "../app/api/lib/with-deadline";

describe("withDeadline", () => {
  it("resolves when the runner finishes before the deadline", async () => {
    const result = await withDeadline(
      async () => "ok",
      { timeoutMs: 500, label: "Test call" }
    );
    assert.equal(result, "ok");
  });

  it("rejects with TimeoutError when the deadline elapses", async () => {
    await assert.rejects(
      () =>
        withDeadline(
          () =>
            new Promise<never>(() => {
              /* hang */
            }),
          { timeoutMs: 20, label: "Test call" }
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "TimeoutError" &&
        /timed out/i.test(error.message)
    );
  });

  it("rejects immediately with TimeoutError when timeoutMs is already exhausted", async () => {
    let ran = false;
    await assert.rejects(
      () =>
        withDeadline(
          async () => {
            ran = true;
            return "unused";
          },
          { timeoutMs: 0, label: "Test call" }
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "TimeoutError" &&
        /timed out/i.test(error.message)
    );
    assert.equal(ran, false);
  });

  it("rejects with AbortError when the external signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        withDeadline(async () => "unused", {
          timeoutMs: 500,
          label: "Test call",
          externalSignal: controller.signal,
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "AbortError" &&
        /cancelled/i.test(error.message)
    );
  });

  it("rejects with AbortError when the external signal aborts during the run", async () => {
    const controller = new AbortController();
    const pending = withDeadline(
      () =>
        new Promise<never>(() => {
          /* hang */
        }),
      {
        timeoutMs: 5_000,
        label: "Test call",
        externalSignal: controller.signal,
      }
    );
    controller.abort();
    await assert.rejects(
      () => pending,
      (error: unknown) =>
        error instanceof Error && error.name === "AbortError"
    );
  });
});
