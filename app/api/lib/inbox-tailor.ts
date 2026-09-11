/**
 * In-process strict tailor from a labeled Gmail payload (R8).
 * Claim + extract, then runTailorCore. Does not mark processed (R10 / M8.5).
 */
import {
  extractUnprocessedInboxMessage,
  renewInboxClaim,
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
  | { ok: false; error: string; status?: 422 | 503; claimToken?: string };

export async function tailorLabeledMessage(
  deps: TailorPipelineDeps,
  input: { messageId: string; message: unknown }
): Promise<TailorLabeledResult> {
  const extracted = await extractUnprocessedInboxMessage(
    input.messageId,
    input.message
  );
  if (!extracted.ok) {
    return extracted;
  }
  if (extracted.status !== "extracted") {
    return { ok: true, status: extracted.status };
  }

  const { claimToken, jobDescription } = extracted;

  if (jobDescription.length > getTailorJdMaxChars()) {
    return {
      ok: false,
      error: "jobDescription exceeds configured size limit.",
      status: 422,
      claimToken,
    };
  }

  const core = await runTailorCore(deps, {
    jobDescription,
    curationMode: "strict",
  });
  if (!core.ok) {
    return { ...core, claimToken };
  }
  const renewed = await renewInboxClaim(input.messageId, claimToken);
  if (!renewed.ok) {
    return { ...renewed, status: 503, claimToken };
  }
  if (!renewed.renewed) {
    return { ok: true, status: "skipped-claimed" };
  }
  return { ok: true, status: "tailored", body: core.body, claimToken };
}
