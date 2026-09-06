import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { gmailFetchJson } from "../app/api/lib/gmail-http";

describe("gmailFetchJson", () => {
  const previous = process.env.GMAIL_HTTP_TIMEOUT_MS;

  beforeEach(() => {
    process.env.GMAIL_HTTP_TIMEOUT_MS = "20";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.GMAIL_HTTP_TIMEOUT_MS;
    else process.env.GMAIL_HTTP_TIMEOUT_MS = previous;
  });

  it("fails closed when the request is aborted by the HTTP timeout", async () => {
    const result = await gmailFetchJson({
      url: "https://gmail.example.test/gmail/v1/users/me/labels",
      accessToken: "token",
      fetchImpl: async (_input, init) => {
        const signal = init?.signal;
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Gmail API request failed/);
    }
  });
});
