/**
 * `assistant-ui` Composer slash-command grammar.
 *
 * The runtime's `onNew` handler must decide "does this text start with
 * a `/magic` token, or is it a regular chat turn?" BEFORE handing it
 * to `chatActions.send()`. This module owns the grammar; the runtime
 * imports `parseMagicCommand()` and `executeMagicCommand()` only.
 *
 * ## Grammar (v1)
 *
 *     /fullflow [free-text topic]          →  enhance → generate → auto-apply
 *     /variants [topic]                    →  multi-platform variant stream
 *     /variants search [topic]             →  + opt into live web search
 *     /variants --search [topic]           →  same opt-in via flag form
 *     /enhance   [text-or-empty]          →  enhance-prompt stream only
 *     /apply                             →  re-apply last committed result
 *     /clear                              →  reset current session
 *     /help                               →  render help message in chat
 *
 * Anything starting with `/` that doesn't match a known command is a
 * "magic-format error" — we render it as a system message rather than
 * silently sending to the LLM (avoids burning tokens on a typo).
 */
import type { ChatMessage } from '@/lib/chat/types'

export type MagicCommand =
  | { kind: 'fullflow'; topic: string }
  | { kind: 'variants'; topic: string; search: boolean }
  | { kind: 'enhance'; text: string }
  | { kind: 'apply' }
  | { kind: 'clear' }
  | { kind: 'help' }
  | { kind: 'error'; reason: string; input: string }

/** Friendly registry for the empty-state suggestion chips. */
export const MAGIC_COMMANDS: ReadonlyArray<{
  cmd: string
  label: string
  blurb: string
}> = [
  { cmd: '/fullflow', label: '一键全流程', blurb: '增强提示词 → 生成 → 自动填写表单' },
  { cmd: '/variants', label: '多平台变体', blurb: '为多个平台同时生成差异化文案' },
  { cmd: '/enhance', label: '提示词增强', blurb: '只跑提示词优化，不消耗生成配额' },
  { cmd: '/apply', label: '应用上一次结果', blurb: '把最近一次回复写回右侧表单' },
  { cmd: '/clear', label: '清空对话', blurb: '重置当前会话，丢弃历史消息' },
  { cmd: '/help', label: '帮助', blurb: '列出所有 /magic 命令和用法' },
]

const KNOWN_TOKENS = new Set(['/fullflow', '/variants', '/enhance', '/apply', '/clear', '/help'])

const HELP_TEXT = [
  '可用的 /magic 命令：',
  '',
  '  /fullflow [主题]               增强提示词 → 生成文案 → 自动应用表单',
  '  /variants [主题]               为多个平台并行生成变体',
  '  /variants search [主题]        等同 `/variants [--search]`：生成前先联网拉取参考资料',
  '  /variants --search=false [主题] 显式关闭联网（默认即为关闭）',
  '  /enhance [文本]                只跑提示词优化',
  '  /apply                        把上一次回复写回表单',
  '  /clear                        清空当前对话',
  '  /help                         显示本帮助',
  '',
  '以 `/` 开头且非上述命令的文字会被拒绝，避免误发给 LLM。',
].join('\n')

/**
 * Pure parser. Exported for unit tests.
 *
 * @param rawText the substring the Composer handed us
 * @returns a typed `MagicCommand`. Returns `{kind:'help'}` (NOT an
 *          error) when the input is the bare `/help` token, so the
 *          terminal UX behaves predictably across forms.
 */
export function parseMagicCommand(rawText: string): MagicCommand {
  const text = rawText.trim()
  if (!text.startsWith('/')) {
    return { kind: 'error', reason: '不以 / 开头', input: rawText }
  }

  const firstToken = text.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const rest = text.slice(firstToken.length).trim()

  if (!KNOWN_TOKENS.has(firstToken)) {
    return { kind: 'error', reason: `未知命令：${firstToken}`, input: rawText }
  }

  switch (firstToken) {
    case '/fullflow':
      return { kind: 'fullflow', topic: rest }
    case '/variants':
      return parseVariants(rest)
    case '/enhance':
      return { kind: 'enhance', text: rest }
    case '/apply':
      return { kind: 'apply' }
    case '/clear':
      return { kind: 'clear' }
    case '/help':
      return { kind: 'help' }
    default:
      // Unreachable: KNOWN_TOKENS guard already handled.
      return { kind: 'error', reason: 'internal: unknown token', input: rawText }
  }
}

/**
 * Inner parser for the `/variants` family of commands.
 *
 * Recognized leading opt-in signals (case-insensitive):
 *
 *     search [topic...]
 *     --search [topic...]
 *     --search=true [topic...]
 *     --search=false [topic...]
 *
 * Anything else is treated as `search: false` (default), and the
 * entire remaining string is the topic verbatim. The signal token
 * (and any single space after it) is consumed; subsequent whitespace
 * joins into the topic.
 *
 * Examples (preserving exact output):
 *
 *     `/variants 美食探店`        → { kind:'variants', topic:'美食探店', search:false }
 *     `/variants search 美食探店`  → { kind:'variants', topic:'美食探店', search:true }
 *     `/variants --search abc def` → { kind:'variants', topic:'abc def', search:true }
 *     `/variants --search=false t` → { kind:'variants', topic:'t', search:false }
 *     `/variants search`           → { kind:'variants', topic:'', search:true }
 *       (empty topic — dispatcher rejects this with the existing
 *       "需要主题文本" breadcrumb; no parser-level error.)
 */
function parseVariants(rest: string): {
  kind: 'variants'
  topic: string
  search: boolean
} {
  // Match the leading opt-in signal + the single space after it.
  // Group 1: full flag token. Group 2: explicit value if any.
  const flagMatch = rest.match(/^(search|--search(?:=(true|false))?)\b\s*/i)
  if (!flagMatch) {
    return { kind: 'variants', topic: rest.trim(), search: false }
  }
  const explicit = flagMatch[2]
  let search: boolean
  if (explicit === undefined) {
    // bare `search` or `--search` (no =value) → opt in
    search = true
  } else {
    search = explicit.toLowerCase() === 'true'
  }
  // Tail after the consumed flag token + its trailing whitespace.
  const body = rest.slice(flagMatch[0].length).trim()
  return { kind: 'variants', topic: body, search }
}

/**
 * The help text rendered into chat when `/help` runs. A pure data
 * export so it can be embedded as a system message OR shown in a
 * static tooltip — same surface either way.
 */
export const MAGIC_HELP_TEXT = HELP_TEXT

/**
 * Build a synthetic `system` chat message that announces the result
 * of a magic command. Lets users stay inside the chat even when
 * slash commands produce side effects (apply, fullflow) or feedback
 * (help, error).
 *
 * Pure: the runtime imports this when an `onNew` decides "this is a
 * magic command, the result is a synthetic message rather than a
 * real LLM turn".
 */
export function buildMagicCommandMessage(command: MagicCommand): ChatMessage {
  let content = ''
  switch (command.kind) {
    case 'fullflow':
      content = command.topic
        ? `🚀 **一键全流程** 已启动 — 主题：「${command.topic}」\n\n增强 → 生成 → 自动应用`
        : `🚀 **一键全流程** 已启动\n\n增强 → 生成 → 自动应用`
      break
    case 'variants':
      // Note the search opt-in in the announcement breadcrumb so the
      // user can see whether the variant generation will fetch live
      // web context (small but visible UX differentiator — the
      // backend will block on /api/ai/search first when search=true).
      content = command.topic
        ? command.search
          ? `🌐🎨 **多平台变体生成** 已启动 — 主题：「${command.topic}」（启用联网）`
          : `🎨 **多平台变体生成** 已启动 — 主题：「${command.topic}」`
        : command.search
          ? `🌐🎨 **多平台变体生成** 已启动（启用联网）`
          : `🎨 **多平台变体生成** 已启动`
      break
    case 'enhance':
      content = command.text
        ? `✨ **提示词增强** 已启动 — 原文：「${command.text}」`
        : `✨ **提示词增强** 已启动`
      break
    case 'apply':
      content = `↩️ **应用上一次结果**`
      break
    case 'clear':
      content = `🧹 **会话已清空**`
      break
    case 'help':
      content = HELP_TEXT
      break
    case 'error':
      content = `❌ **Magic 命令错误**：${command.reason}\n\n输入 \`/help\` 查看可用命令。`
      break
  }
  return {
    id: crypto.randomUUID(),
    role: 'system',
    content,
    createdAt: Date.now(),
  }
}
