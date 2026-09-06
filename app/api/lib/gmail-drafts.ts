/**
 * Gmail reply drafts: RFC2822 MIME + create-or-reuse (R10, R11).
 */
import { randomBytes } from "node:crypto";
import {
  getGmailApiBaseUrl,
  getGmailCvAttachmentFilename,
} from "./gmail-config";
import { gmailFetchJson } from "./gmail-http";
import {
  parseGmailReplyHeaders,
} from "./gmail-message";
import {
  refreshGmailAccessToken,
  type FetchLike,
} from "./gmail-oauth";

export type EnsureReplyDraftResult =
  | { ok: true; status: "created" | "reused" }
  | { ok: false; error: string };

const MIME_LINE_LENGTH = 76;
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function jsonObject(raw: unknown): object | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  return raw;
}

export function wrapMimeBase64(value: string): string {
  const compact = value.replace(/\s+/g, "");
  const lines: string[] = [];
  for (let i = 0; i < compact.length; i += MIME_LINE_LENGTH) {
    lines.push(compact.slice(i, i + MIME_LINE_LENGTH));
  }
  return lines.join("\r\n");
}

export function threadContainsDraft(raw: unknown): boolean {
  const root = jsonObject(raw);
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
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${input.boundary}"`,
  ];
  if (input.inReplyTo !== undefined) {
    lines.push(`In-Reply-To: ${input.inReplyTo}`);
    lines.push(`References: ${input.inReplyTo}`);
  }
  lines.push(
    "",
    `--${input.boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
    `--${input.boundary}`,
    `Content-Type: ${DOCX_CONTENT_TYPE}; name="${input.attachmentFilename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${input.attachmentFilename}"`,
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
}): Promise<{ ok: true; hasDraft: boolean } | { ok: false; error: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const token = await refreshGmailAccessToken({ fetchImpl });
  if (!token.ok) {
    return { ok: false, error: token.error };
  }
  const base = getGmailApiBaseUrl().replace(/\/+$/, "");
  const threadRes = await gmailFetchJson({
    url: `${base}/users/me/threads/${encodeURIComponent(params.threadId)}`,
    accessToken: token.data.accessToken,
    fetchImpl,
  });
  if (!threadRes.ok) {
    return { ok: false, error: threadRes.error };
  }
  return { ok: true, hasDraft: threadContainsDraft(threadRes.body) };
}

export async function ensureReplyDraft(params: {
  sourceMessage: unknown;
  replyText: string;
  docxBase64: string;
  fetchImpl?: FetchLike;
  boundary?: string;
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
  const token = await refreshGmailAccessToken({ fetchImpl });
  if (!token.ok) {
    return { ok: false, error: token.error };
  }
  const base = getGmailApiBaseUrl().replace(/\/+$/, "");
  const threadUrl = `${base}/users/me/threads/${encodeURIComponent(headers.headers.threadId)}`;
  const threadRes = await gmailFetchJson({
    url: threadUrl,
    accessToken: token.data.accessToken,
    fetchImpl,
  });
  if (!threadRes.ok) {
    return { ok: false, error: threadRes.error };
  }
  if (threadContainsDraft(threadRes.body)) {
    return { ok: true, status: "reused" };
  }
  const boundary =
    params.boundary ?? `ccc-${randomBytes(12).toString("hex")}`;
  const rfc822 = buildReplyRfc822({
    to: headers.headers.to,
    subject: headers.headers.subject,
    body: replyText,
    attachmentFilename: getGmailCvAttachmentFilename(),
    docxBase64: params.docxBase64,
    boundary,
    inReplyTo: headers.headers.inReplyTo,
  });
  const createRes = await gmailFetchJson({
    url: `${base}/users/me/drafts`,
    accessToken: token.data.accessToken,
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
