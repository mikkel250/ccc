import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attachMockExitGuard } from "../dev/start-mocks.mjs";

type FakeChild = EventEmitter & {
  killed: boolean;
  exitCode: number | null;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.killed = false;
  child.exitCode = null;
  return child;
}

describe("attachMockExitGuard", () => {
  it("stops the other mock and exits once when the first child exits", () => {
    const first = fakeChild();
    const second = fakeChild();
    const killed: FakeChild[] = [];
    const exits: number[] = [];
    attachMockExitGuard([first, second], {
      kill(child) {
        killed.push(child as FakeChild);
        (child as FakeChild).killed = true;
      },
      exitProcess(status) {
        exits.push(status);
      },
    });

    first.emit("exit", 2, null);
    second.emit("exit", 0, null);

    assert.deepEqual(killed, [second]);
    assert.deepEqual(exits, [2]);
  });

  it("uses a nonzero status when a child is signalled, and shutdown is single-shot", () => {
    const first = fakeChild();
    const second = fakeChild();
    const killed: FakeChild[] = [];
    const exits: number[] = [];
    const guard = attachMockExitGuard([first, second], {
      kill(child) {
        killed.push(child as FakeChild);
        (child as FakeChild).killed = true;
      },
      exitProcess(status) {
        exits.push(status);
      },
    });

    first.emit("exit", null, "SIGKILL");
    guard.shutdown(130);
    second.emit("exit", null, "SIGTERM");

    assert.deepEqual(killed, [second]);
    assert.deepEqual(exits, [1]);
  });
});
