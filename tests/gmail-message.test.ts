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

  it("fails closed when threadId is missing", () => {
    const result = parseGmailReplyHeaders({
      payload: {
        headers: [{ name: "From", value: "recruiter@example.com" }],
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /threadId/);
    }
  });

  it("fails closed when threadId is blank", () => {
    const result = parseGmailReplyHeaders({
      threadId: "  ",
      payload: {
        headers: [{ name: "From", value: "recruiter@example.com" }],
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /threadId/);
    }
  });

  it("fails closed when payload.headers is missing", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {},
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("fails closed when From is blank", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "From", value: "   " }] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("fails closed when From is not a string", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "From", value: 42 }] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("fails closed when Reply-To is blank and From is missing", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "Reply-To", value: "" }] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("fails closed when Reply-To is not a string and From is missing", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "Reply-To", value: null }] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("prefers Reply-To over From", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "via@mailer.example" },
          { name: "Reply-To", value: "recruiter@example.com" },
          { name: "Subject", value: "GM role" },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.headers.to, "recruiter@example.com");
    }
  });

  it("strips CR/LF from header values used as MIME fields", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "recruiter@example.com\r\nBcc: evil@x.com" },
          { name: "Subject", value: "GM\nrole" },
          { name: "Message-ID", value: "<id@mail>\r\nX-Injected: 1" },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.headers.to.includes("\n"), false);
      assert.equal(result.headers.to.includes("\r"), false);
      assert.equal(result.headers.subject.includes("\n"), false);
      assert.equal(result.headers.inReplyTo?.includes("\r"), false);
      assert.equal(result.headers.inReplyTo?.includes("\n"), false);
    }
  });
});
