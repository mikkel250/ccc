/**
 * In-process strict tailor from a labeled Gmail payload (R8).
 * Claim + extract, then runTailorCore. Does not mark processed (R10 / M8.5).
 * Returns claimToken on success so M8.5 can mark processed only while this
 * worker still owns the claim. Releases the claim on non-crash failures.
 */
import {
  extractUnprocessedInboxMessage,
  releaseInboxClaim,
  INBOX_REDIS_TIMEOUT_ERROR,
  INBOX_REDIS_UNAVAILABLE_ERROR,
} from "./inbox-processed-store";
import { getTailorJdMaxChars } from "./cv-schema";
import {
  runTailorCore,
  type TailorCoreSuccess,
  type TailorPipelineDeps,
} from "./tailor-pipeline";

export type TailorLabeledResult =
  | { ok: true; status: "tailored"; body: TailorCoreSuccess; claimToken: string }
  | { ok: true; status: "skipped-processed" }
  | { ok: true; status: "skipped-claimed" }
  | { ok: false; error: string; status?: 422 | 503 };

function isInboxRedisError(error: string): boolean {
  return (
    error === INBOX_REDIS_TIMEOUT_ERROR ||
    error === INBOX_REDIS_UNAVAILABLE_ERROR
  );
}

export async function tailorLabeledMessage(
  deps: TailorPipelineDeps,
  input: { messageId: string; message: unknown }
): Promise<TailorLabeledResult> {
  const extracted = await extractUnprocessedInboxMessage(
    input.messageId,
    input.message
  );
  if (!extracted.ok) {
    return isInboxRedisError(extracted.error)
      ? { ok: false, error: extracted.error, status: 503 }
      : extracted;
  }
  if (extracted.status !== "extracted") {
    return { ok: true, status: extracted.status };
  }

  if (extracted.jobDescription.length > getTailorJdMaxChars()) {
    await releaseInboxClaim(input.messageId, extracted.claimToken);
    return {
      ok: false,
      error: "jobDescription exceeds configured size limit.",
      status: 422,
    };
  }

  const core = await runTailorCore(deps, {
    jobDescription: extracted.jobDescription,
    curationMode: "strict",
  });
  if (!core.ok) {
    await releaseInboxClaim(input.messageId, extracted.claimToken);
    return core;
  }
  return {
    ok: true,
    status: "tailored",
    body: core.body,
    claimToken: extracted.claimToken,
  };
}
