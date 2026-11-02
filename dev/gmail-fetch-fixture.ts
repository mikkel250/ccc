/**
 * In-process Gmail fetch stand-in. Intercepts the production HTTPS Gmail URLs.
 * Do not point GMAIL_*_URL at http:// — gmail-config requires HTTPS.
 */
import type { FetchLike } from "../app/api/lib/gmail-oauth";

export const LOCAL_INBOX_MESSAGE_ID = "local-mock-msg-1";
export const LOCAL_INBOX_THREAD_ID = "local-mock-thread-1";
export const LOCAL_INBOX_JD =
  "We need a general manager with P&L ownership and a track record of operations leadership.";

export type GmailFetchFixtureOptions = {
  messageId?: string;
  threadId?: string;
  jobDescription?: string;
  threadDraft?: boolean;
  onDraftCreate?: () => void;
};

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function recruiterMessageFixture(options: GmailFetchFixtureOptions = {}): unknown {
  const id = options.messageId ?? LOCAL_INBOX_MESSAGE_ID;
  const threadId = options.threadId ?? LOCAL_INBOX_THREAD_ID;
  const jobDescription = options.jobDescription ?? LOCAL_INBOX_JD;
  return {
    id,
    threadId,
    payload: {
      mimeType: "text/plain",
      body: { data: b64url(jobDescription) },
      headers: [
        { name: "From", value: "recruiter@example.com" },
        { name: "Subject", value: "GM role" },
        { name: "Message-ID", value: `<${id}@mail.example>` },
      ],
    },
  };
}

/** Fetch implementation that never leaves process; matches default HTTPS Gmail hosts. */
export function createGmailFetchFixture(
  options: GmailFetchFixtureOptions = {}
): FetchLike {
  const messageId = options.messageId ?? LOCAL_INBOX_MESSAGE_ID;
  const threadId = options.threadId ?? LOCAL_INBOX_THREAD_ID;
  const message = recruiterMessageFixture(options);
  return async (input, init) => {
    const url = String(input);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/token") || url.includes("/token")) {
      return jsonResponse({ access_token: "local-mock-access", expires_in: 3600 });
    }
    if (parsed.pathname.endsWith("/users/me/labels")) {
      const configured = process.env.GMAIL_RECRUITER_LABEL?.trim();
      return jsonResponse({
        labels: [{ id: "Label_recruiter", name: configured ? configured : "Recruiter" }],
      });
    }
    if (parsed.pathname.endsWith("/users/me/drafts") && init?.method === "POST") {
      options.onDraftCreate?.();
      return jsonResponse({ id: "local-mock-draft" });
    }
    if (parsed.pathname.includes("/users/me/threads/")) {
      return jsonResponse({
        messages: options.threadDraft
          ? [{ id: "d1", labelIds: ["DRAFT"] }]
          : [{ id: messageId, labelIds: ["INBOX"] }],
      });
    }
    if (/\/users\/me\/messages\/[^/]+$/.test(parsed.pathname)) {
      return jsonResponse(message);
    }
    if (parsed.pathname.endsWith("/users/me/messages")) {
      return jsonResponse({
        messages: [{ id: messageId, threadId }],
      });
    }
    throw new Error(`unexpected Gmail fixture URL ${url}`);
  };
}

const HTTPS_TOKEN_DEFAULT = "https://oauth2.googleapis.com/token";
const HTTPS_API_DEFAULT = "https://gmail.googleapis.com/gmail/v1";

/**
 * Fill dummy Gmail env so scanInbox can run. Never rewrites URLs to http://.
 * Existing values are preserved.
 */
export function applyLocalInboxGmailEnv(): void {
  process.env.INBOX_SCAN_ENABLED ??= "1";
  process.env.INBOX_SCAN_BACKOFF_MS ??= "0";
  process.env.GMAIL_CLIENT_ID ??= "local-dev-gmail-client-id";
  process.env.GMAIL_CLIENT_SECRET ??= "local-dev-gmail-client-secret";
  process.env.GMAIL_REFRESH_TOKEN ??= "local-dev-gmail-refresh-token";
  process.env.GMAIL_RECRUITER_LABEL ??= "Recruiter";
  process.env.GMAIL_OAUTH_TOKEN_URL ??= HTTPS_TOKEN_DEFAULT;
  process.env.GMAIL_API_BASE_URL ??= HTTPS_API_DEFAULT;
  process.env.GMAIL_CV_ATTACHMENT_FILENAME ??= "CV.docx";
}

export function assertLocalInboxGmailUrlsAreHttps(): void {
  const tokenUrl = process.env.GMAIL_OAUTH_TOKEN_URL ?? HTTPS_TOKEN_DEFAULT;
  const apiUrl = process.env.GMAIL_API_BASE_URL ?? HTTPS_API_DEFAULT;
  if (!tokenUrl.startsWith("https://") || !apiUrl.startsWith("https://")) {
    throw new Error("GMAIL_OAUTH_TOKEN_URL and GMAIL_API_BASE_URL must be HTTPS");
  }
}
