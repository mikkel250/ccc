/**
 * Local/Railway inbox scan: list → tailor → draft → processed (R9–R13).
 * A per-thread Redis claim is held from before tailor through drafts.create.
 * Railway cron wiring is M8.6; this module is the shared job.
 */
import { tailorCvDeps } from "./tailor-cv-deps";
import { listLabeledRecruiterMail } from "./gmail-list";
import { getGmailMessage, parseGmailReplyHeaders } from "./gmail-message";
import { ensureReplyDraft, gmailThreadHasDraft } from "./gmail-drafts";
import { getInboxScanBackoffMs, isInboxScanEnabled } from "./inbox-config";
import {
  claimInboxMessage,
  claimInboxThread,
  isInboxProcessed,
  markInboxProcessed,
  releaseInboxClaim,
  releaseInboxThreadClaim,
  renewInboxClaim,
  renewInboxThreadClaim,
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
  fetchImpl: FetchLike;
  deps: TailorPipelineDeps;
}): Promise<InboxScanItem> {
  const { messageId, fetchImpl, deps } = params;
  let claimToken: string | undefined;
  let threadClaimToken: string | undefined;
  let claimedThreadId: string | undefined;
  try {
    const processed = await isInboxProcessed(messageId);
    if (!processed.ok) {
      return {
        messageId,
        status: "fetch-failed",
        error: processed.error,
      };
    }
    if (processed.processed) {
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
    const replyHeaders = parseGmailReplyHeaders(fetched.message);
    if (!replyHeaders.ok) {
      return {
        messageId,
        status: "draft-failed",
        error: replyHeaders.error,
      };
    }
    const replyThreadId = replyHeaders.headers.threadId;
    const existing = await gmailThreadHasDraft({
      threadId: replyThreadId,
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
      const claimed = await claimInboxMessage(messageId);
      if (!claimed.ok) {
        return {
          messageId,
          status: "draft-failed",
          error: claimed.error,
        };
      }
      if (claimed.outcome === "processed") {
        return { messageId, status: "skipped-processed" };
      }
      if (claimed.outcome !== "won") {
        return { messageId, status: "skipped-claimed" };
      }
      const marked = await markInboxProcessed(messageId, claimed.token);
      return {
        messageId,
        status: "reused-draft",
        ...(marked.ok ? {} : { error: marked.error }),
      };
    }
    const threadClaim = await claimInboxThread(replyThreadId);
    if (!threadClaim.ok) {
      return {
        messageId,
        status: "draft-failed",
        error: threadClaim.error,
      };
    }
    if (threadClaim.outcome !== "won") {
      return { messageId, status: "skipped-claimed" };
    }
    threadClaimToken = threadClaim.token;
    claimedThreadId = replyThreadId;
    const tailored = await tailorLabeledMessage(deps, {
      messageId,
      message: fetched.message,
    });
    if (tailored.ok && tailored.status === "tailored") {
      claimToken = tailored.claimToken;
    }
    if (tailored.ok && tailored.status !== "tailored") {
      return { messageId, status: tailored.status };
    }
    if (!tailored.ok) {
      return {
        messageId,
        status: "tailor-failed",
        error: tailored.error,
      };
    }
    const renewed = await renewInboxClaim(messageId, tailored.claimToken);
    if (!renewed.ok) {
      await releaseInboxClaim(messageId, tailored.claimToken);
      return {
        messageId,
        status: "draft-failed",
        error: renewed.error,
      };
    }
    if (!renewed.renewed) {
      return { messageId, status: "skipped-claimed" };
    }
    const threadRenewed = await renewInboxThreadClaim(
      replyThreadId,
      threadClaim.token
    );
    if (!threadRenewed.ok) {
      await releaseInboxClaim(messageId, tailored.claimToken);
      return {
        messageId,
        status: "draft-failed",
        error: threadRenewed.error,
      };
    }
    if (!threadRenewed.renewed) {
      await releaseInboxClaim(messageId, tailored.claimToken);
      return { messageId, status: "skipped-claimed" };
    }
    const drafted = await ensureReplyDraft({
      sourceMessage: fetched.message,
      replyText: tailored.body.replyText ?? "",
      docxBase64: tailored.body.cv,
      fetchImpl,
    });
    if (!drafted.ok) {
      await releaseInboxClaim(messageId, tailored.claimToken);
      return {
        messageId,
        status: "draft-failed",
        error: drafted.error,
      };
    }
    const marked = await markInboxProcessed(messageId, tailored.claimToken);
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
  } finally {
    if (threadClaimToken !== undefined && claimedThreadId !== undefined) {
      await releaseInboxThreadClaim(claimedThreadId, threadClaimToken);
    }
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
