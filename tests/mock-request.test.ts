import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { guardMockRequest } from "../dev/mock-request.mjs";

type MockResponse = {
  headersSent: boolean;
  destroyed: boolean;
  writableEnded: boolean;
  statusCode?: number;
  body?: string;
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
};

function mockResponse(): MockResponse {
  return {
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    writeHead(status, _headers) {
      this.statusCode = status;
      this.headersSent = true;
    },
    end(body) {
      this.body = body;
      this.writableEnded = true;
    },
  };
}

async function flushGuard(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("guardMockRequest", () => {
  it("logs a non-disconnect error and returns JSON with status 500", async () => {
    const res = mockResponse();
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    const failure = new Error("boom");
    try {
      guardMockRequest(
        async () => {
          throw failure;
        },
        {} as IncomingMessage,
        res as unknown as ServerResponse
      );
      await flushGuard();
      assert.equal(res.statusCode, 500);
      assert.equal(res.headersSent, true);
      assert.deepEqual(JSON.parse(res.body ?? ""), { error: "internal error" });
      assert.equal(logged.length, 1);
      assert.ok(Array.isArray(logged[0]) && logged[0].includes(failure));
    } finally {
      console.error = original;
    }
  });

  it("returns without logging when the error is a client disconnect", async () => {
    const res = mockResponse();
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    const failure = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    try {
      guardMockRequest(
        async () => {
          throw failure;
        },
        {} as IncomingMessage,
        res as unknown as ServerResponse
      );
      await flushGuard();
      assert.equal(res.headersSent, false);
      assert.equal(res.body, undefined);
      assert.deepEqual(logged, []);
    } finally {
      console.error = original;
    }
  });
});
