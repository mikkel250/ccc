/**
 * List Gmail messages that carry the operator recruiter label (R6).
 */
import {
  getGmailApiBaseUrl,
  getGmailListMaxResults,
  getGmailRecruiterLabel,
} from "./gmail-config";
import {
  refreshGmailAccessToken,
  type FetchLike,
} from "./gmail-oauth";

export type GmailListedMessage = {
  id: string;
  threadId: string;
};

export type GmailListResult =
  | { ok: true; messages: GmailListedMessage[] }
  | { ok: false; error: string };

function jsonObject(raw: unknown): object | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  return raw;
}

async function gmailGetJson(
  url: string,
  accessToken: string,
  fetchImpl: FetchLike
): Promise<GmailListResult & { body?: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { ok: false, error: "Gmail API request failed" };
  }
  if (!response.ok) {
    return { ok: false, error: `Gmail API HTTP ${response.status}` };
  }
  try {
    return { ok: true, messages: [], body: await response.json() };
  } catch {
    return { ok: false, error: "Gmail API response was not valid JSON" };
  }
}

export type GmailLabelMatch =
  | { ok: true; labelId: string }
  | { ok: false; error: string };

export function matchGmailLabelId(
  labelsRaw: unknown,
  wantedName: string
): GmailLabelMatch {
  const root = jsonObject(labelsRaw);
  const labels = root === undefined ? undefined : Reflect.get(root, "labels");
  if (!Array.isArray(labels)) {
    return { ok: false, error: "Gmail labels response was not an object" };
  }
  const wanted = wantedName.trim();
  let caseInsensitiveId: string | undefined;
  for (const entry of labels) {
    if (entry === null || typeof entry !== "object") continue;
    const id = Reflect.get(entry, "id");
    const name = Reflect.get(entry, "name");
    if (typeof id !== "string" || id.trim() === "") continue;
    if (typeof name !== "string") continue;
    if (name === wanted) {
      return { ok: true, labelId: id };
    }
    if (
      caseInsensitiveId === undefined &&
      name.toLowerCase() === wanted.toLowerCase()
    ) {
      caseInsensitiveId = id;
    }
  }
  if (caseInsensitiveId !== undefined) {
    return { ok: true, labelId: caseInsensitiveId };
  }
  return { ok: false, error: "Gmail recruiter label not found" };
}

export function parseGmailMessageList(
  raw: unknown
): GmailListResult {
  const root = jsonObject(raw);
  if (root === undefined) {
    return { ok: false, error: "Gmail messages response was not an object" };
  }
  const messagesRaw = Reflect.get(root, "messages");
  if (messagesRaw === undefined) {
    return { ok: true, messages: [] };
  }
  if (!Array.isArray(messagesRaw)) {
    return { ok: false, error: "Gmail messages response was not an object" };
  }
  const messages: GmailListedMessage[] = [];
  for (const entry of messagesRaw) {
    if (entry === null || typeof entry !== "object") {
      return { ok: false, error: "Gmail messages response was not an object" };
    }
    const id = Reflect.get(entry, "id");
    const threadId = Reflect.get(entry, "threadId");
    if (typeof id !== "string" || id.trim() === "") {
      return { ok: false, error: "Gmail messages response was not an object" };
    }
    if (typeof threadId !== "string" || threadId.trim() === "") {
      return { ok: false, error: "Gmail messages response was not an object" };
    }
    messages.push({ id: id.trim(), threadId: threadId.trim() });
  }
  return { ok: true, messages };
}

export async function listLabeledRecruiterMail(params?: {
  fetchImpl?: FetchLike;
}): Promise<GmailListResult> {
  const fetchImpl = params?.fetchImpl ?? fetch;
  const token = await refreshGmailAccessToken({ fetchImpl });
  if (!token.ok) {
    return { ok: false, error: token.error };
  }
  const base = getGmailApiBaseUrl().replace(/\/+$/, "");
  const labelsRes = await gmailGetJson(
    `${base}/users/me/labels`,
    token.data.accessToken,
    fetchImpl
  );
  if (!labelsRes.ok) {
    return { ok: false, error: labelsRes.error };
  }
  const matched = matchGmailLabelId(labelsRes.body, getGmailRecruiterLabel());
  if (!matched.ok) {
    return { ok: false, error: matched.error };
  }
  const maxResults = getGmailListMaxResults();
  const listUrl = new URL(`${base}/users/me/messages`);
  listUrl.searchParams.set("labelIds", matched.labelId);
  listUrl.searchParams.set("maxResults", String(maxResults));
  const listRes = await gmailGetJson(
    listUrl.toString(),
    token.data.accessToken,
    fetchImpl
  );
  if (!listRes.ok) {
    return { ok: false, error: listRes.error };
  }
  return parseGmailMessageList(listRes.body);
}
