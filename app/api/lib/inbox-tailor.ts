/**
 * In-process strict tailor from a labeled Gmail payload (R8).
 * Claim + extract, then runTailorCore. Does not mark processed (R10 / M8.5).
 * Returns claimToken on success so M8.5 can mark processed only while this
 * worker still owns the claim. Releases the claim on non-crash failures.
 */
import {
  extractUnprocessedInboxMessage,
  releaseInboxClaim,
  renewInboxClaim,
  INBOX_CLAIM_LOST_ERROR,
  INBOX_REDIS_TIMEOUT_ERROR,
  INBOX_REDIS_UNAVAILABLE_ERROR,
} from "./inbox-processed-store";
import { getInboxClaimTtlSeconds } from "./inbox-config";
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

function leaseRenewalFailure(
  result: { ok: true; renewed: boolean } | { ok: false; error: string }
): { ok: false; error: string } | null {
  if (!result.ok) {
    return result;
  }
  if (!result.renewed) {
    return { ok: false, error: INBOX_CLAIM_LOST_ERROR };
  }
  return null;
}

async function withClaimLease<T>(
  messageId: string,
  claimToken: string,
  work: (signal: AbortSignal) => Promise<T>
): Promise<
  | { ok: true; value: T }
  | { ok: true; status: "skipped-claimed" }
  | { ok: false; error: string }
> {
  const ttlSeconds = getInboxClaimTtlSeconds();
  const intervalMs = Math.max(250, Math.floor((ttlSeconds * 1000) / 2));
  const initial = await renewInboxClaim(messageId, claimToken);
  if (!initial.ok) {
    return initial;
  }
  if (!initial.renewed) {
    return { ok: true, status: "skipped-claimed" };
  }

  const abortController = new AbortController();
  let finished = false;
  let resolveLost: (result: { ok: false; error: string }) => void = () => {};
  const leaseLost = new Promise<{ ok: false; error: string }>((resolve) => {
    resolveLost = resolve;
  });
  const timer = setInterval(() => {
    void renewInboxClaim(messageId, claimToken)
      .then((result) => {
        if (finished) {
          return;
        }
        const failure = leaseRenewalFailure(result);
        if (failure) {
          resolveLost(failure);
        }
      })
      .catch(() => {
        if (!finished) {
          resolveLost({ ok: false, error: INBOX_REDIS_UNAVAILABLE_ERROR });
        }
      });
  }, intervalMs);
  const workPromise = work(abortController.signal);
  try {
    const raced = await Promise.race([
      workPromise.then((value) => ({ kind: "work" as const, value })),
      leaseLost.then((lost) => ({ kind: "lost" as const, lost })),
    ]);
    if (raced.kind === "lost") {
      abortController.abort();
      await workPromise.catch(() => {});
      return raced.lost;
    }
    return { ok: true, value: raced.value };
  } finally {
    finished = true;
    clearInterval(timer);
  }
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

  let core: Awaited<ReturnType<typeof runTailorCore>>;
  try {
    const leased = await withClaimLease(
      input.messageId,
      extracted.claimToken,
      (signal) =>
        runTailorCore(deps, {
          jobDescription: extracted.jobDescription,
          curationMode: "strict",
          signal,
        })
    );
    if (leased.ok && "status" in leased) {
      await releaseInboxClaim(input.messageId, extracted.claimToken);
      return { ok: true, status: "skipped-claimed" };
    }
    if (!leased.ok) {
      if (!isInboxRedisError(leased.error)) {
        await releaseInboxClaim(input.messageId, extracted.claimToken);
      }
      return { ok: false, error: leased.error, status: 503 };
    }
    core = leased.value;
  } catch {
    await releaseInboxClaim(input.messageId, extracted.claimToken);
    return {
      ok: false,
      error: "AI service error. Please try again.",
      status: 503,
    };
  }
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
