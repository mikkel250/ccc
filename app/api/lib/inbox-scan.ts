/**
 * Local/Railway inbox scan: list → tailor → draft → processed (R9–R13).
 * Railway cron wiring is M8.6; this module is the shared job.
 */
import { tailorCvDeps } from "./tailor-cv-deps";
import { listLabeledRecruiterMail } from "./gmail-list";
import { getGmailMessage } from "./gmail-message";
import { ensureReplyDraft, gmailThreadHasDraft } from "./gmail-drafts";
import { getInboxScanBackoffMs } from "./inbox-config";
import {
  isInboxProcessed,
  markInboxProcessed,
} from "./inbox-processed-store";
import { tailorLabeledMessage } from "./inbox-tailor";
import type { TailorPipelineDeps } from "./tailor-pipeline";
import type { FetchLike } from "./gmail-oauth";

export type InboxScanItemStatus =
  | "skipped-processed"
  | "skipped-claimed"
  | "drafted"
  | "reused-draft"
  | "tailor-failed"
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

export async function scanInbox(params?: {
  fetchImpl?: FetchLike;
  tailorDeps?: TailorPipelineDeps;
  sleep?: (ms: number) => Promise<void>;
}): Promise<InboxScanResult> {
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
    const messageId = listedMessage.id;
    if (await isInboxProcessed(messageId)) {
      items.push({ messageId, status: "skipped-processed" });
    } else {
      const fetched = await getGmailMessage({ messageId, fetchImpl });
      if (!fetched.ok) {
        items.push({
          messageId,
          status: "draft-failed",
          error: fetched.error,
        });
      } else {
        const existing = await gmailThreadHasDraft({
          threadId: listedMessage.threadId,
          fetchImpl,
        });
        if (!existing.ok) {
          items.push({
            messageId,
            status: "draft-failed",
            error: existing.error,
          });
        } else if (existing.hasDraft) {
          const marked = await markInboxProcessed(messageId);
          items.push({
            messageId,
            status: "reused-draft",
            ...(marked.ok ? {} : { error: marked.error }),
          });
        } else {
          const tailored = await tailorLabeledMessage(deps, {
            messageId,
            message: fetched.message,
          });
          if (tailored.ok && tailored.status !== "tailored") {
            items.push({ messageId, status: tailored.status });
          } else if (!tailored.ok) {
            items.push({
              messageId,
              status: "tailor-failed",
              error: tailored.error,
            });
          } else {
            const drafted = await ensureReplyDraft({
              sourceMessage: fetched.message,
              replyText: tailored.body.replyText ?? "",
              docxBase64: tailored.body.cv,
              fetchImpl,
            });
            if (!drafted.ok) {
              items.push({
                messageId,
                status: "draft-failed",
                error: drafted.error,
              });
            } else {
              const marked = await markInboxProcessed(messageId);
              items.push({
                messageId,
                status: drafted.status === "reused" ? "reused-draft" : "drafted",
                ...(marked.ok ? {} : { error: marked.error }),
              });
            }
          }
        }
      }
    }
    if (i < listed.messages.length - 1) {
      await sleep(backoffMs);
    }
  }
  return { ok: true, items };
}
