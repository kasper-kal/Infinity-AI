/**
 * Re-export shim for legacy `./llm` import paths used by self-evolution and
 * swebench. Centralizes the model-agnostic LLM helpers so callers don't need to
 * know the underlying module layout.
 */
export { createBestAdapter } from "./adapter-factory";
export { buildInfinityPrompt } from "./infinity-prompt";
export type { LLMAdapter, MessageRole, LLMMessage } from "./llm-adapter";
