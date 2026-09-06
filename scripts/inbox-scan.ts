/**
 * Scan labeled recruiter mail, tailor in-process, create or reuse a thread draft (R13).
 *
 * Usage: npm run inbox:scan
 */
import { config as loadDotenv } from "dotenv";
import { pathToFileURL } from "node:url";
import { scanInbox } from "../app/api/lib/inbox-scan";
import type { InboxScanItem } from "../app/api/lib/inbox-scan";

loadDotenv();

export function formatScanItemLine(item: {
  messageId: string;
  status: string;
  error?: string;
}): string {
  return JSON.stringify(item);
}

export function inboxScanCliExitCode(
  result: { ok: true; items: InboxScanItem[] } | { ok: false; error: string }
): 0 | 1 {
  if (!result.ok) {
    return 1;
  }
  if (
    result.items.some(
      (item) => item.status === "tailor-failed" || item.status === "draft-failed"
    )
  ) {
    return 1;
  }
  return 0;
}

export async function runInboxScanCli(): Promise<
  { ok: true; lines: string[]; items: InboxScanItem[] } | { ok: false; error: string }
> {
  const result = await scanInbox();
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, lines: result.items.map(formatScanItemLine), items: result.items };
}

async function main(): Promise<void> {
  const result = await runInboxScanCli();
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }
  for (const line of result.lines) {
    console.log(line);
  }
  process.exitCode = inboxScanCliExitCode(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
