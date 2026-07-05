/**
 * Shared tracing contract implemented by every observability backend adapter.
 *
 * One `TracePayload` shape and one `Tracer` interface replace the previous
 * pair of near-identical, loosely-typed `traceLLMCall` functions in
 * `langsmith.ts` and `langfuse.ts`. Adding a new backend (Datadog, Braintrust,
 * etc.) means adding a new adapter file, not touching `llm.ts` or the other
 * adapters.
 */
import type { ChatMessage, ChatOptions, ChatResponse, Provider } from '../llm';
import type { LangfusePromptRef } from './langfuse';

export type TraceOptions = Omit<
  ChatOptions,
  'openaiClient' | 'openRouterClient' | 'deepseekClient' | 'anthropicClient'
>;

export function toTraceOptions(options: ChatOptions): TraceOptions {
  const {
    openaiClient: _openaiClient,
    openRouterClient: _openRouterClient,
    deepseekClient: _deepseekClient,
    anthropicClient: _anthropicClient,
    ...traceSafe
  } = options;
  return traceSafe;
}

export interface TracePayload {
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  systemPrompt: string;
  response: ChatResponse;
  startTime: number;
  options: TraceOptions;
  langfusePrompt?: LangfusePromptRef | null;
}

export interface Tracer {
  readonly name: string;
  isEnabled(): boolean;
  record(payload: TracePayload): Promise<void>;
}
