/**
 * Node-only startup work for instrumentation.ts.
 * Kept in a separate file so the Edge instrumentation compile never
 * pulls node:crypto / fs via tailor-auth or master-cv.
 */
import { ensureSecureStartup } from "./app/api/lib/tailor-auth";
import { preloadMasterCv } from "./app/api/lib/master-cv";

export async function registerNode(): Promise<void> {
  ensureSecureStartup();
  await preloadMasterCv();
}
