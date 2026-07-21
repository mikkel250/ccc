/**
 * Next.js instrumentation hook.
 *
 * - Enforces R5d auth startup fatality (bypass + production markers).
 * - Preloads master CV asynchronously so request handlers never sync-read disk.
 * - Langfuse OpenTelemetry stays lazy in app/api/lib/langfuse-otel.ts — loading
 *   @opentelemetry/sdk-node here breaks Next dev webpack (grpc/fs). Per-request
 *   generations still use app/api/lib/langfuse.ts.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { ensureSecureStartup } = await import("./app/api/lib/tailor-auth");
  ensureSecureStartup();

  const { preloadMasterCv } = await import("./app/api/lib/master-cv");
  await preloadMasterCv();
}
