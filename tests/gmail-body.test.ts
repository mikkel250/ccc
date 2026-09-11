import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractGmailJobDescription,
  htmlToText,
} from "../app/api/lib/gmail-body";

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

describe("htmlToText", () => {
  it("strips tags and decodes basic entities", () => {
    assert.equal(htmlToText("<p>Need a GM &amp; chef</p>"), "Need a GM & chef");
  });

  it("decodes hexadecimal and named HTML entities", () => {
    assert.equal(
      htmlToText("<p>GM&#x2019;s role &mdash; hire now</p>"),
      "GM\u2019s role \u2014 hire now"
    );
  });

  it("drops comments, head, and hidden inner text", () => {
    const html = [
      "<html><head><title>Tracking pixel</title></head>",
      "<body>",
      "<!-- recruiter-only: ignore this -->",
      '<p>Need a GM</p>',
      '<div style="display:none">SECRET_TRACKING_TOKEN</div>',
      "<span hidden>hidden-copy</span>",
      "</body></html>",
    ].join("");
    const text = htmlToText(html);
    assert.match(text, /Need a GM/);
    assert.doesNotMatch(text, /SECRET_TRACKING_TOKEN/);
    assert.doesNotMatch(text, /hidden-copy/);
    assert.doesNotMatch(text, /Tracking pixel/);
    assert.doesNotMatch(text, /recruiter-only/);
  });

  it("drops hidden text that contains a nested same-name tag", () => {
    const text = htmlToText(
      '<div style="display:none">A<div>B</div>SECRET_TRACKING_TOKEN</div>visible'
    );
    assert.match(text, /visible/);
    assert.doesNotMatch(text, /SECRET_TRACKING_TOKEN/);
  });
});

describe("extractGmailJobDescription", () => {
  it("prefers text/plain over text/html in multipart", () => {
    const result = extractGmailJobDescription({
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: b64("Plain JD for a GM role.") },
          },
          {
            mimeType: "text/html",
            body: { data: b64("<p>HTML JD should lose.</p>") },
          },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.jobDescription, "Plain JD for a GM role.");
    }
  });

  it("falls back to html-to-text when plain is missing", () => {
    const result = extractGmailJobDescription({
      payload: {
        mimeType: "text/html",
        body: { data: b64("<p>Hire a <b>GM</b></p>") },
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.jobDescription, "Hire a GM");
    }
  });

  it("walks nested multipart parts", () => {
    const result = extractGmailJobDescription({
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                body: { data: b64("Nested plain JD.") },
              },
            ],
          },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.jobDescription, "Nested plain JD.");
    }
  });

  it("fails when the payload has no usable text", () => {
    const result = extractGmailJobDescription({
      payload: { mimeType: "multipart/mixed", parts: [] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /no usable text/);
    }
  });
});
