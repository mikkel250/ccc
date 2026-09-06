/**
 * Scan labeled recruiter mail, tailor in-process, create or reuse a thread draft (R13).
 *
 * Usage: npm run inbox:scan
 */
import { config as loadDotenv } from "dotenv";
import { pathToFileURL } from "node:url";
import { scanInbox } from "../app/api/lib/inbox-scan";

loadDotenv();

export function formatScanItemLine(item: {
  messageId: string;
  status: string;
  error?: string;
}): string {
  return JSON.stringify(item);
}

export async function runInboxScanCli(): Promise<
  { ok: true; lines: string[] } | { ok: false; error: string }
> {
  const result = await scanInbox();
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, lines: result.items.map(formatScanItemLine) };
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
