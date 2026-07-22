/**
 * AiSidebar — backward-compatible export shim.
 *
 * The original 1380-line `AiSidebar` was replaced by the much smaller
 * assistant-ui-driven `AiAssistantPanel` under
 * `@/features/ai-assistant`. This file stays in place to preserve
 * the legacy import path used by `PublishAiSidebar` and any stray
 * tests that still rely on `AiGenerationResult`.
 *
 * DO NOT add new logic here — port consumers to import from
 * `@/features/ai-assistant` instead.
 */
export { AiAssistantPanel as AiSidebar } from '@/features/ai-assistant'
export type { AiGenerationResult } from '@/features/ai-assistant'
