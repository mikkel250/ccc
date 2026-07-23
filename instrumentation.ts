/**
 * Next.js instrumentation hook.
 *
 * - Enforces R5d auth startup fatality (bypass + production markers).
 * - Preloads master CV asynchronously so request handlers never sync-read disk.
 * - Langfuse OpenTelemetry stays lazy in app/api/lib/langfuse-otel.ts — loading
 *   @opentelemetry/sdk-node here breaks Next dev webpack (grpc/fs). Per-request
 *   generations still use app/api/lib/langfuse.ts.
 *
 * Node-only work lives in instrumentation.node.ts. next.config IgnorePlugin keeps
 * the Edge instrumentation compile from pulling that module (node:crypto / fs).
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerNode } = await import("./instrumentation.node");
  await registerNode();
}
