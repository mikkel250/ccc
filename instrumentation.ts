/**
 * Next.js instrumentation hook (required file; kept minimal).
 *
 * Langfuse OpenTelemetry is started lazily from app/api/lib/langfuse-otel.ts
 * on the first LLM call. Loading @opentelemetry/sdk-node here breaks Next dev
 * webpack (grpc/fs). Per-request generations still use app/api/lib/langfuse.ts.
 */

export async function register() {
  // No-op — see langfuse-otel.ts
}
