/**
 * Gmail reply drafts: RFC2822 MIME + create-or-reuse (R10, R11).
 */
import { randomBytes } from "node:crypto";
import {
  getGmailApiBaseUrl,
  getGmailCvAttachmentFilename,
} from "./gmail-config";
import { gmailFetchJson, gmailJsonObject, sanitizeMimeHeaderValue } from "./gmail-http";
import {
  parseGmailReplyHeaders,
} from "./gmail-message";
import {
  resolveGmailAccessToken,
  type FetchLike,
} from "./gmail-oauth";

export type EnsureReplyDraftResult =
  | { ok: true; status: "created" | "reused" }
  | { ok: false; error: string };

const MIME_LINE_LENGTH = 76;
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function wrapMimeBase64(value: string): string {
  const compact = value.replace(/\s+/g, "");
  const lines: string[] = [];
  for (let i = 0; i < compact.length; i += MIME_LINE_LENGTH) {
    lines.push(compact.slice(i, i + MIME_LINE_LENGTH));
  }
  return lines.join("\r\n");
}

export function threadContainsDraft(raw: unknown): boolean {
  const root = gmailJsonObject(raw);
  if (root === undefined) {
    return false;
  }
  const messages = Reflect.get(root, "messages");
  if (!Array.isArray(messages)) {
    return false;
  }
  for (const entry of messages) {
    if (entry === null || typeof entry !== "object") continue;
    const labels = Reflect.get(entry, "labelIds");
    if (!Array.isArray(labels)) continue;
    if (labels.some((label) => label === "DRAFT")) {
      return true;
    }
  }
  return false;
}

export function buildReplyRfc822(input: {
  to: string;
  subject: string;
  body: string;
  attachmentFilename: string;
  docxBase64: string;
  boundary: string;
  inReplyTo?: string;
}): string {
  const lines = [
    `To: ${sanitizeMimeHeaderValue(input.to)}`,
    `Subject: ${sanitizeMimeHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${input.boundary}"`,
  ];
  if (input.inReplyTo !== undefined) {
    const inReplyTo = sanitizeMimeHeaderValue(input.inReplyTo);
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${inReplyTo}`);
  }
  lines.push(
    "",
    `--${input.boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
    `--${input.boundary}`,
    `Content-Type: ${DOCX_CONTENT_TYPE}; name="${sanitizeMimeHeaderValue(input.attachmentFilename)}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${sanitizeMimeHeaderValue(input.attachmentFilename)}"`,
    "",
    wrapMimeBase64(input.docxBase64),
    `--${input.boundary}--`,
    ""
  );
  return lines.join("\r\n");
}

export async function gmailThreadHasDraft(params: {
  threadId: string;
  fetchImpl?: FetchLike;
  accessToken?: string;
}): Promise<
  | { ok: true; hasDraft: boolean; accessToken: string }
  | { ok: false; error: string }
> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const token = await resolveGmailAccessToken({
    fetchImpl,
    accessToken: params.accessToken,
  });
  if (!token.ok) {
    return { ok: false, error: token.error };
  }
  const base = getGmailApiBaseUrl();
  const threadRes = await gmailFetchJson({
    url: `${base}/users/me/threads/${encodeURIComponent(params.threadId)}`,
    accessToken: token.data.accessToken,
    fetchImpl,
  });
  if (!threadRes.ok) {
    return { ok: false, error: threadRes.error };
  }
  return {
    ok: true,
    hasDraft: threadContainsDraft(threadRes.body),
    accessToken: token.data.accessToken,
  };
}

export async function ensureReplyDraft(params: {
  sourceMessage: unknown;
  replyText: string;
  docxBase64: string;
  fetchImpl?: FetchLike;
  boundary?: string;
  /** Prefetched token; skips refresh when set. With hasDraft, also skips thread GET. */
  accessToken?: string;
  /** Prefetched draft presence from gmailThreadHasDraft; skips the thread GET when set with accessToken. */
  hasDraft?: boolean;
}): Promise<EnsureReplyDraftResult> {
  const replyText = params.replyText.trim();
  if (replyText === "") {
    return { ok: false, error: "Reply text is blank; not creating a stub draft" };
  }
  const headers = parseGmailReplyHeaders(params.sourceMessage);
  if (!headers.ok) {
    return headers;
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  const prefetchedHasDraft = params.hasDraft;
  const reuseThreadState =
    params.accessToken !== undefined && prefetchedHasDraft !== undefined;

  let accessToken: string;
  let hasDraft: boolean;
  if (reuseThreadState) {
    accessToken = params.accessToken;
    hasDraft = prefetchedHasDraft;
  } else {
    const token = await resolveGmailAccessToken({
      fetchImpl,
      accessToken: params.accessToken,
    });
    if (!token.ok) {
      return { ok: false, error: token.error };
    }
    accessToken = token.data.accessToken;
    const base = getGmailApiBaseUrl();
    const threadUrl = `${base}/users/me/threads/${encodeURIComponent(headers.headers.threadId)}`;
    const threadRes = await gmailFetchJson({
      url: threadUrl,
      accessToken,
      fetchImpl,
    });
    if (!threadRes.ok) {
      return { ok: false, error: threadRes.error };
    }
    hasDraft = threadContainsDraft(threadRes.body);
  }
  if (hasDraft) {
    return { ok: true, status: "reused" };
  }
  let attachmentFilename: string;
  try {
    attachmentFilename = getGmailCvAttachmentFilename();
  } catch {
    return { ok: false, error: "GMAIL_CV_ATTACHMENT_FILENAME is not a valid filename" };
  }
  const boundary =
    params.boundary ?? `ccc-${randomBytes(12).toString("hex")}`;
  const rfc822 = buildReplyRfc822({
    to: headers.headers.to,
    subject: headers.headers.subject,
    body: replyText,
    attachmentFilename,
    docxBase64: params.docxBase64,
    boundary,
    inReplyTo: headers.headers.inReplyTo,
  });
  const base = getGmailApiBaseUrl();
  const createRes = await gmailFetchJson({
    url: `${base}/users/me/drafts`,
    accessToken,
    fetchImpl,
    method: "POST",
    jsonBody: {
      message: {
        threadId: headers.headers.threadId,
        raw: Buffer.from(rfc822, "utf8").toString("base64url"),
      },
    },
  });
  if (!createRes.ok) {
    return { ok: false, error: createRes.error };
  }
  return { ok: true, status: "created" };
}
