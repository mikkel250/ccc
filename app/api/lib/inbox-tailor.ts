/**
 * In-process strict tailor from a labeled Gmail payload (R8).
 * Claim + extract, then runTailorCore. Does not mark processed (R10 / M8.5).
 */
import { extractUnprocessedInboxMessage } from "./inbox-processed-store";
import { getTailorJdMaxChars } from "./cv-schema";
import {
  runTailorCore,
  type TailorCoreSuccess,
  type TailorPipelineDeps,
} from "./tailor-pipeline";

export type TailorLabeledResult =
  | { ok: true; status: "tailored"; body: TailorCoreSuccess }
  | { ok: true; status: "skipped-processed" }
  | { ok: true; status: "skipped-claimed" }
  | { ok: false; error: string; status?: 422 | 503 };

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

  if (extracted.jobDescription.length > getTailorJdMaxChars()) {
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
    return core;
  }
  return { ok: true, status: "tailored", body: core.body };
}
