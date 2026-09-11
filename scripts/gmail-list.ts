/**
 * List Gmail messages with GMAIL_RECRUITER_LABEL (R6 / R13).
 *
 * Usage: npm run gmail:list
 */
import { config as loadDotenv } from "dotenv";
import { pathToFileURL } from "node:url";
import { ServiceError } from "../app/api/lib/errors";
import { listLabeledRecruiterMail } from "../app/api/lib/gmail-list";
import type { FetchLike } from "../app/api/lib/gmail-oauth";

loadDotenv();

/** Serialize one listed Gmail message as a JSON line. */
export function formatListedMessageLine(message: {
  id: string;
  threadId: string;
}): string {
  return JSON.stringify(message);
}

/** Fetch recruiter-labeled messages and format them for CLI output. */
export async function runGmailListCli(params?: {
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  try {
    const result = await listLabeledRecruiterMail({
      fetchImpl: params?.fetchImpl,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const lines = result.messages.map(formatListedMessageLine);
    return { ok: true, lines };
  } catch (error: unknown) {
    if (error instanceof ServiceError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** Execute the Gmail list CLI and write its lines or failure to the console. */
async function main(): Promise<void> {
  const result = await runGmailListCli();
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }
  for (const line of result.lines) {
    console.log(line);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
