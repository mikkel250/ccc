/**
 * List Gmail messages with GMAIL_RECRUITER_LABEL (R6 / R13).
 *
 * Usage: npm run gmail:list
 */
import { config as loadDotenv } from "dotenv";
import { pathToFileURL } from "node:url";
import { listLabeledRecruiterMail } from "../app/api/lib/gmail-list";
import type { FetchLike } from "../app/api/lib/gmail-oauth";

loadDotenv();

export function formatListedMessageLine(message: {
  id: string;
  threadId: string;
}): string {
  return JSON.stringify(message);
}

export async function runGmailListCli(params?: {
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  const result = await listLabeledRecruiterMail({
    fetchImpl: params?.fetchImpl,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const lines = result.messages.map(formatListedMessageLine);
  return { ok: true, lines };
}

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
