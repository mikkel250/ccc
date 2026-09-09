/**
 * Local/Railway inbox scan: list → tailor → draft → processed (R9–R13).
 * Railway cron wiring is M8.6; this module is the shared job.
 */
import { tailorCvDeps } from "./tailor-cv-deps";
import { listLabeledRecruiterMail } from "./gmail-list";
import { getGmailMessage } from "./gmail-message";
import { ensureReplyDraft, gmailThreadHasDraft } from "./gmail-drafts";
import { getInboxScanBackoffMs, isInboxScanEnabled } from "./inbox-config";
import {
  isInboxProcessed,
  markInboxProcessed,
  releaseInboxClaim,
} from "./inbox-processed-store";
import { tailorLabeledMessage } from "./inbox-tailor";
import type { TailorPipelineDeps } from "./tailor-pipeline";
import { refreshGmailAccessToken, type FetchLike } from "./gmail-oauth";

export type InboxScanItemStatus =
  | "skipped-processed"
  | "skipped-claimed"
  | "drafted"
  | "reused-draft"
  | "tailor-failed"
  | "fetch-failed"
  | "draft-failed";

export type InboxScanItem = {
  messageId: string;
  status: InboxScanItemStatus;
  error?: string;
};

export type InboxScanResult =
  | { ok: true; items: InboxScanItem[] }
  | { ok: false; error: string };

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function scanOneMessage(params: {
  messageId: string;
  threadId: string;
  fetchImpl: FetchLike;
  deps: TailorPipelineDeps;
}): Promise<InboxScanItem> {
  const { messageId, threadId, fetchImpl, deps } = params;
  let claimToken: string | undefined;
  try {
    if (await isInboxProcessed(messageId)) {
      return { messageId, status: "skipped-processed" };
    }
    const token = await refreshGmailAccessToken({ fetchImpl });
    if (!token.ok) {
      return {
        messageId,
        status: "fetch-failed",
        error: token.error,
      };
    }
    const accessToken = token.data.accessToken;
    const fetched = await getGmailMessage({
      messageId,
      fetchImpl,
      accessToken,
    });
    if (!fetched.ok) {
      return {
        messageId,
        status: "fetch-failed",
        error: fetched.error,
      };
    }
    const existing = await gmailThreadHasDraft({
      threadId,
      fetchImpl,
      accessToken,
    });
    if (!existing.ok) {
      return {
        messageId,
        status: "draft-failed",
        error: existing.error,
      };
    }
    if (existing.hasDraft) {
      const marked = await markInboxProcessed(messageId);
      return {
        messageId,
        status: "reused-draft",
        ...(marked.ok ? {} : { error: marked.error }),
      };
    }
    const tailored = await tailorLabeledMessage(deps, {
      messageId,
      message: fetched.message,
    });
    if (tailored.ok && tailored.status === "tailored") {
      claimToken = tailored.claimToken;
    } else if (!tailored.ok) {
      claimToken = tailored.claimToken;
    }
    if (tailored.ok && tailored.status !== "tailored") {
      return { messageId, status: tailored.status };
    }
    if (!tailored.ok) {
      if (tailored.status === 503 && claimToken) {
        await releaseInboxClaim(messageId, claimToken);
      }
      return {
        messageId,
        status: "tailor-failed",
        error: tailored.error,
      };
    }
    const drafted = await ensureReplyDraft({
      sourceMessage: fetched.message,
      replyText: tailored.body.replyText ?? "",
      docxBase64: tailored.body.cv,
      fetchImpl,
      accessToken,
    });
    if (!drafted.ok) {
      await releaseInboxClaim(messageId, tailored.claimToken);
      return {
        messageId,
        status: "draft-failed",
        error: drafted.error,
      };
    }
    const marked = await markInboxProcessed(messageId);
    return {
      messageId,
      status: drafted.status === "reused" ? "reused-draft" : "drafted",
      ...(marked.ok ? {} : { error: marked.error }),
    };
  } catch (error: unknown) {
    if (claimToken) {
      await releaseInboxClaim(messageId, claimToken);
    }
    const errorMessage =
      error instanceof Error ? error.message : "Inbox scan item failed";
    return {
      messageId,
      status: "draft-failed",
      error: errorMessage,
    };
  }
}

export async function scanInbox(params?: {
  fetchImpl?: FetchLike;
  tailorDeps?: TailorPipelineDeps;
  sleep?: (ms: number) => Promise<void>;
}): Promise<InboxScanResult> {
  if (!isInboxScanEnabled()) {
    return {
      ok: false,
      error: "Inbox scan is disabled (set INBOX_SCAN_ENABLED=1)",
    };
  }
  const fetchImpl = params?.fetchImpl ?? fetch;
  const deps = params?.tailorDeps ?? tailorCvDeps;
  const sleep = params?.sleep ?? defaultSleep;
  const listed = await listLabeledRecruiterMail({ fetchImpl });
  if (!listed.ok) {
    return listed;
  }
  const items: InboxScanItem[] = [];
  const backoffMs = getInboxScanBackoffMs();
  for (let i = 0; i < listed.messages.length; i++) {
    const listedMessage = listed.messages[i]!;
    items.push(
      await scanOneMessage({
        messageId: listedMessage.id,
        threadId: listedMessage.threadId,
        fetchImpl,
        deps,
      })
    );
    if (i < listed.messages.length - 1) {
      await sleep(backoffMs);
    }
  }
  return { ok: true, items };
}
