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

  it("decodes hexadecimal numeric and named apostrophe entities", () => {
    assert.equal(htmlToText("Need a GM&#x2019;s chef"), "Need a GM\u2019s chef");
    assert.equal(htmlToText("It&apos;s a GM role"), "It's a GM role");
  });

  it("leaves prototype property names unchanged", () => {
    assert.equal(
      htmlToText("<p>Role &constructor; here</p>"),
      "Role &constructor; here"
    );
  });

  it("decodes hexadecimal and named HTML entities", () => {
    assert.equal(
      htmlToText("<p>GM&#x2019;s role &mdash; hire now</p>"),
      "GM\u2019s role \u2014 hire now"
    );
  });

  it("leaves prototype property names as literal entities", () => {
    assert.equal(htmlToText("<p>&amp;toString;</p>"), "&toString;");
  });

  it("rejects surrogate numeric entities instead of decoding them", () => {
    assert.equal(htmlToText("<p>&#xD800;visible</p>"), "visible");
    assert.equal(htmlToText("<p>&#55296;visible</p>"), "visible");
  });

  it("rejects NUL numeric entities instead of decoding them", () => {
    assert.equal(htmlToText("<p>&#0;visible</p>"), "visible");
    assert.equal(htmlToText("<p>&#x0;visible</p>"), "visible");
  });

  it("decodes uppercase HTML entity aliases without folding case", () => {
    assert.equal(htmlToText("A &QUOT;quote&QUOT;"), 'A "quote"');
    assert.equal(htmlToText("Brand &COPY; mark"), "Brand \u00A9 mark");
    assert.equal(htmlToText("Brand &REG; mark"), "Brand \u00AE mark");
    assert.equal(htmlToText("A &Quot;quote&Quot;"), "A &Quot;quote&Quot;");
  });

  it("drops text hidden with an HTML5 colon entity", () => {
    assert.equal(
      htmlToText('<div style="display&colon;none">SECRET</div>visible'),
      "visible"
    );
  });

  it("keeps text when a surrogate breaks a hidden style name", () => {
    const text = htmlToText(
      '<div style="display&#xD800;:none">SECRET</div>visible'
    );
    assert.match(text, /SECRET/);
    assert.match(text, /visible/);
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

  it("drops hidden text that contains a nested differently named tag", () => {
    const text = htmlToText(
      '<div style="display:none">A<span>B</span><script>SECRET_TRACKING_TOKEN</script></div>visible'
    );
    assert.match(text, /visible/);
    assert.doesNotMatch(text, /SECRET_TRACKING_TOKEN/);
  });

  it("drops text styled with visibility:hidden", () => {
    const text = htmlToText(
      '<div style="visibility:hidden">SECRET_TRACKING_TOKEN</div>visible'
    );
    assert.match(text, /visible/);
    assert.doesNotMatch(text, /SECRET_TRACKING_TOKEN/);
  });

  it("keeps text inside overflow:hidden layout wrappers", () => {
    assert.equal(
      htmlToText('<div style="overflow:hidden">Need a GM</div>'),
      "Need a GM"
    );
    assert.equal(
      htmlToText('<div style="overflow: hidden !important">Need a GM</div>'),
      "Need a GM"
    );
  });

  it("keeps text inside class names that contain hidden as a token", () => {
    assert.equal(
      htmlToText('<div class="hidden-sm">Need a GM</div>'),
      "Need a GM"
    );
  });

  it("keeps text inside aria-hidden=false", () => {
    assert.equal(
      htmlToText('<div aria-hidden="false">Need a GM</div>'),
      "Need a GM"
    );
  });

  it("drops text marked aria-hidden=true", () => {
    const text = htmlToText(
      '<div aria-hidden="true">SECRET_TRACKING_TOKEN</div>visible'
    );
    assert.match(text, /visible/);
    assert.doesNotMatch(text, /SECRET_TRACKING_TOKEN/);
  });

  it("keeps the JD when head is unclosed but body follows", () => {
    const text = htmlToText(
      "<html><head><title>x</title><body><p>Need a GM</p></body></html>"
    );
    assert.match(text, /Need a GM/);
    assert.doesNotMatch(text, /^x$/);
  });

  it("keeps the JD when an unclosed head is followed by content tags", () => {
    for (const html of [
      '<html><head><meta charset="utf-8"><table><tr><td>Need a GM</td></tr></table></html>',
      "<html><head><title>Tracking</title><p>Need a GM</p>",
      "<html><head><title>Tracking</title><div>Need a GM</div>",
    ]) {
      const text = htmlToText(html);
      assert.match(text, /Need a GM/);
      assert.doesNotMatch(text, /Tracking/);
    }
  });

  it("does not end an unclosed head on a tag nested inside title or svg", () => {
    const nestedTitle = htmlToText(
      "<html><head><title><p>SECRET</p></title><body><p>Need a GM</p></body></html>"
    );
    assert.match(nestedTitle, /Need a GM/);
    assert.doesNotMatch(nestedTitle, /SECRET/);

    const nestedSvg = htmlToText(
      "<html><head><svg><table><tr><td>SECRET</td></tr></table></svg></head><body><p>Need a GM</p></body></html>"
    );
    assert.match(nestedSvg, /Need a GM/);
    assert.doesNotMatch(nestedSvg, /SECRET/);
  });

  it("omits an unclosed hidden container through EOF", () => {
    const text = htmlToText(
      '<div style="display:none">TRACKING<p>Need a GM</p>'
    );
    assert.doesNotMatch(text, /TRACKING/);
    assert.doesNotMatch(text, /Need a GM/);
  });

  it("does not treat a body token inside head script as skip recovery", () => {
    const text = htmlToText(
      '<html><head><script>var t="<body>SECRET_TRACKING"</script></head><body><p>Need a GM</p></body></html>'
    );
    assert.match(text, /Need a GM/);
    assert.doesNotMatch(text, /SECRET_TRACKING/);
  });

  it("does not treat a body token inside head style as skip recovery", () => {
    const text = htmlToText(
      '<html><head><style>.x { content: "<body>SECRET_TRACKING" }</style></head><body><p>Need a GM</p></body></html>'
    );
    assert.match(text, /Need a GM/);
    assert.doesNotMatch(text, /SECRET_TRACKING/);
  });

  it("keeps max-height:0 text when overflow is not clipping", () => {
    assert.equal(
      htmlToText('<div style="max-height:0">Need a GM</div>'),
      "Need a GM"
    );
    assert.equal(
      htmlToText('<div style="max-height:0;overflow:visible">Need a GM</div>'),
      "Need a GM"
    );
    assert.equal(
      htmlToText('<div style="max-height:0;text-overflow:clip">Need a GM</div>'),
      "Need a GM"
    );
  });

  it("drops unquoted display:none and entity-encoded hidden styles", () => {
    const unquoted = htmlToText('<div style=display:none>SECRET</div>visible');
    assert.match(unquoted, /visible/);
    assert.doesNotMatch(unquoted, /SECRET/);

    const encoded = htmlToText(
      '<div style=&quot;display:none&quot;>SECRET</div>visible'
    );
    assert.match(encoded, /visible/);
    assert.doesNotMatch(encoded, /SECRET/);
  });

  it("keeps message text after a hidden void element", () => {
    assert.equal(
      htmlToText(
        '<img src="logo.png" alt="" aria-hidden="true"><p>Need a GM</p>'
      ),
      "Need a GM"
    );
    assert.equal(
      htmlToText('<img src="open.gif" style="display:none"><p>Need a GM</p>'),
      "Need a GM"
    );
  });

  it("keeps a positive font-size inside a font-size:0 wrapper", () => {
    const text = htmlToText(
      '<td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;"><div style="font-size:13px">Need a GM</div></td>'
    );
    assert.equal(text, "Need a GM");

    const mixed = htmlToText(
      '<div style="font-size:0">SECRET<div style="font-size:13px">Need a GM</div>TAIL</div>visible'
    );
    assert.match(mixed, /Need a GM/);
    assert.match(mixed, /visible/);
    assert.doesNotMatch(mixed, /SECRET/);
    assert.doesNotMatch(mixed, /TAIL/);
  });

  it("drops common email preheader hiding styles", () => {
    for (const html of [
      '<div style="max-height:0;overflow:hidden">SECRET</div>visible',
      '<div style="max-height:0;overflow:clip">SECRET</div>visible',
      '<div style="max-height:0;overflow:scroll">SECRET</div>visible',
      '<div style="opacity:0">SECRET</div>visible',
      '<div style="font-size:0">SECRET</div>visible',
    ]) {
      const text = htmlToText(html);
      assert.match(text, /visible/);
      assert.doesNotMatch(text, /SECRET/);
    }
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

  it("rejects a non-object Gmail message", () => {
    const result = extractGmailJobDescription("not-an-object");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /not an object/);
    }
  });

  it("treats empty or whitespace body data as missing text", () => {
    for (const data of ["", b64("   "), b64("\n\t ")]) {
      const result = extractGmailJobDescription({
        payload: {
          mimeType: "text/plain",
          body: { data },
        },
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /no usable text/);
      }
    }
    const htmlBlank = extractGmailJobDescription({
      payload: {
        mimeType: "text/html",
        body: { data: b64("<p>   </p>") },
      },
    });
    assert.equal(htmlBlank.ok, false);
    if (!htmlBlank.ok) {
      assert.match(htmlBlank.error, /no usable text/);
    }
  });

  it("extracts html-only JD wrapped in overflow:hidden", () => {
    const result = extractGmailJobDescription({
      payload: {
        mimeType: "text/html",
        body: { data: b64('<div style="overflow:hidden">Need a GM</div>') },
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.jobDescription, "Need a GM");
    }
  });

  it("ignores MIME parts that are attachments", () => {
    const result = extractGmailJobDescription({
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            filename: "",
            body: { data: b64("Need a GM") },
          },
          {
            mimeType: "text/plain",
            filename: "secret.txt",
            body: { data: b64("ATTACHMENT_SECRET") },
          },
          {
            mimeType: "text/plain",
            headers: [
              { name: "Content-Disposition", value: 'attachment; filename="note.txt"' },
            ],
            body: { data: b64("DISPOSITION_SECRET") },
          },
          {
            mimeType: "text/plain",
            body: { attachmentId: "att-1", data: b64("ATTACHMENT_ID_SECRET") },
          },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.jobDescription, "Need a GM");
    }
  });

  it("reads a job description nested in a forwarded message attachment", () => {
    const result = extractGmailJobDescription({
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: b64("FYI") },
          },
          {
            mimeType: "message/rfc822",
            filename: "Role.eml",
            headers: [
              {
                name: "Content-Disposition",
                value: 'attachment; filename="Role.eml"',
              },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: b64("Need a GM") },
              },
            ],
          },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.jobDescription, "FYI\n\nNeed a GM");
    }
  });

  it("fails when the only text parts are attachments", () => {
    const result = extractGmailJobDescription({
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            filename: "jd.txt",
            body: { data: b64("Need a GM") },
          },
        ],
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /no usable text/);
    }
  });
});
