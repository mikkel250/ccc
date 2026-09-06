/**
 * Gmail users.messages.get + reply-header parse (R10).
 */
import { getGmailApiBaseUrl } from "./gmail-config";
import { gmailFetchJson, gmailJsonObject, sanitizeMimeHeaderValue } from "./gmail-http";
import {
  resolveGmailAccessToken,
  type FetchLike,
} from "./gmail-oauth";
import { parseInboxMessageId } from "./inbox-processed-store";

export type GmailReplyHeaders = {
  to: string;
  subject: string;
  threadId: string;
  inReplyTo?: string;
};

export type GmailMessageResult =
  | { ok: true; message: unknown }
  | { ok: false; error: string };

export type GmailReplyHeadersResult =
  | { ok: true; headers: GmailReplyHeaders }
  | { ok: false; error: string };

function headerValue(headers: unknown, name: string): string | undefined {
  if (!Array.isArray(headers)) {
    return undefined;
  }
  const wanted = name.toLowerCase();
  for (const entry of headers) {
    if (entry === null || typeof entry !== "object") continue;
    const headerName = Reflect.get(entry, "name");
    const headerValueRaw = Reflect.get(entry, "value");
    if (typeof headerName !== "string" || typeof headerValueRaw !== "string") {
      continue;
    }
    if (headerName.toLowerCase() !== wanted) continue;
    const trimmed = sanitizeMimeHeaderValue(headerValueRaw);
    if (trimmed !== "") {
      return trimmed;
    }
  }
  return undefined;
}

function formatReplySubject(subjectRaw: string | undefined): string {
  if (subjectRaw === undefined) {
    return "Re:";
  }
  if (/^re:\s*/i.test(subjectRaw)) {
    return subjectRaw;
  }
  return `Re: ${subjectRaw}`;
}

export function parseGmailReplyHeaders(message: unknown): GmailReplyHeadersResult {
  const root = gmailJsonObject(message);
  if (root === undefined) {
    return { ok: false, error: "Gmail message was not an object" };
  }
  const threadIdRaw = Reflect.get(root, "threadId");
  if (typeof threadIdRaw !== "string" || threadIdRaw.trim() === "") {
    return { ok: false, error: "Gmail message missing threadId" };
  }
  const payload = Reflect.get(root, "payload");
  const payloadObj = gmailJsonObject(payload);
  const headers =
    payloadObj === undefined ? undefined : Reflect.get(payloadObj, "headers");
  const from = headerValue(headers, "From");
  const replyTo = headerValue(headers, "Reply-To");
  const to = replyTo ?? from;
  if (to === undefined) {
    return { ok: false, error: "Gmail message missing From header" };
  }
  const subject = formatReplySubject(headerValue(headers, "Subject"));
  const messageId = headerValue(headers, "Message-ID") ?? headerValue(headers, "Message-Id");
  return {
    ok: true,
    headers: {
      to,
      subject,
      threadId: threadIdRaw.trim(),
      ...(messageId !== undefined ? { inReplyTo: messageId } : {}),
    },
  };
}

export async function getGmailMessage(params: {
  messageId: string;
  fetchImpl?: FetchLike;
  accessToken?: string;
}): Promise<GmailMessageResult> {
  const parsed = parseInboxMessageId(params.messageId);
  if (!parsed.ok) {
    return parsed;
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  const token = await resolveGmailAccessToken({
    fetchImpl,
    accessToken: params.accessToken,
  });
  if (!token.ok) {
    return { ok: false, error: token.error };
  }
  const base = getGmailApiBaseUrl();
  const url = new URL(
    `${base}/users/me/messages/${encodeURIComponent(parsed.messageId)}`
  );
  url.searchParams.set("format", "full");
  const res = await gmailFetchJson({
    url: url.toString(),
    accessToken: token.data.accessToken,
    fetchImpl,
  });
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  return { ok: true, message: res.body };
}
