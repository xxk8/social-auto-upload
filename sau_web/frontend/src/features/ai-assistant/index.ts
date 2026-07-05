/**
 * ai-assistant feature barrel.
 *
 * Exposes the new chat-surface API + supporting pieces. The legacy
 * `Components/AiSidebar/*` exports stay in place during migration;
 * new callers should import from here.
 *
 *   - `AiAssistantPanel`      — top-level shell, used by PublishAiSidebar
 *   - `AiRuntimeProvider`     — runtime adapter for assistant-ui (low-level)
 *   - `AiSettingsPopover`     — API-key management popover
 *   - `MagicSuggestions`      — empty-state suggestion chips
 *   - InlineMagicBar          — / shortcut bar above composer
 *   - magicCommands           — /magic parser + help strings
 */

export { AiAssistantPanel } from './AiAssistantPanel'
export { AiRuntimeProvider, buildMagicCommandMessage } from './AiRuntimeProvider'
export { useAiChat } from './useAiChat'
export type { UseAiChatParams, UseAiChatResult, ParsedResponse } from './useAiChat'
export {
  AiSettingsPopover,
  AiSettingsHeader,
  ModelInlinePicker,
  ModelPickerLabel,
} from './AiSettingsPopover'
export {
  MagicSuggestions,
  InlineMagicBar,
  buildSuggestions,
} from './MagicSuggestions'
export {
  parseMagicCommand,
  buildMagicCommandMessage as buildMagicCommandMessageFromCmd,
  MAGIC_COMMANDS,
  MAGIC_HELP_TEXT,
  type MagicCommand,
} from './magicCommands'
export {
  buildRuntimeMessages,
  convertMessage,
  STREAMING_TAIL_ID,
  type AssistantMessage,
  type ThreadMessageLike,
} from './externalMessageConverter'

// Re-export the shared form-bridge type so the legacy
// `Components/AiSidebar/AiSidebar` shim and its consumers can keep
// importing `AiGenerationResult` from `@/features/ai-assistant`.
export type { AiGenerationResult } from '@/lib/chat/chatFormBridge'
