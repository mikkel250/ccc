import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseGmailReplyHeaders,
} from "../app/api/lib/gmail-message";

describe("parseGmailReplyHeaders", () => {
  it("maps From to To and prefixes Re: when needed", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "recruiter@example.com" },
          { name: "Subject", value: "GM role" },
          { name: "Message-ID", value: "<id@mail>" },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.headers, {
        to: "recruiter@example.com",
        subject: "Re: GM role",
        threadId: "t1",
        inReplyTo: "<id@mail>",
      });
    }
  });

  it("keeps an existing Re: subject", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "a@b.com" },
          { name: "Subject", value: "Re: already" },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.headers.subject, "Re: already");
      assert.equal(result.headers.inReplyTo, undefined);
    }
  });

  it("fails closed without From", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "Subject", value: "Hi" }] },
    });
    assert.equal(result.ok, false);
  });
});
