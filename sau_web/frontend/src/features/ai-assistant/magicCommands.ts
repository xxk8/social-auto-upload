/**
 * Slash-command grammar for the publish AI assistant (Claude Code style).
 *
 * ## Content generation
 *   /fullflow [topic]     enhance → generate → auto-apply
 *   /variants [topic]     multi-platform variants
 *   /enhance [text]       prompt enhance only
 *   /apply                re-apply last assistant result
 *
 * ## Form control
 *   /title <text>         set title
 *   /desc <text>          set description
 *   /tags a,b,c           set tags
 *   /mode video|note      switch publish mode
 *   /group <name>         select account group
 *   /platform a,b         filter platforms inside current group
 *   /schedule <when>      set schedule (YYYY-MM-DD HH:MM | 明天 18:00 | now)
 *   /status               dump form + selection status
 *   /publish | /submit    submit the form
 *
 * ## Skills
 *   /skills               list web skills
 *   /skill <id>           load skill context for subsequent generates
 *
 * ## Session
 *   /clear                reset session
 *   /help                 this help
 */
import type { ChatMessage } from '@/lib/chat/types'
import { formatSkillsHelp, PUBLISH_SKILLS } from './publishSkills'

export type MagicCommand =
  | { kind: 'fullflow'; topic: string }
  | { kind: 'variants'; topic: string; search: boolean }
  | { kind: 'enhance'; text: string }
  | { kind: 'apply' }
  | { kind: 'clear' }
  | { kind: 'help' }
  | { kind: 'title'; text: string }
  | { kind: 'desc'; text: string }
  | { kind: 'tags'; text: string }
  | { kind: 'mode'; mode: 'video' | 'note' }
  | { kind: 'group'; query: string }
  | { kind: 'platform'; raw: string }
  | { kind: 'schedule'; when: string }
  | { kind: 'status' }
  | { kind: 'publish' }
  | { kind: 'skills' }
  | { kind: 'skill'; query: string }
  | { kind: 'error'; reason: string; input: string }

/** Menu / autocomplete registry (Claude Code style). */
export const MAGIC_COMMANDS: ReadonlyArray<{
  cmd: string
  label: string
  blurb: string
  /** Optional argument hint shown in slash menu. */
  args?: string
}> = [
  { cmd: '/fullflow', label: '一键生成并填表', blurb: '增强 → 生成 → 自动填表', args: '[主题]' },
  { cmd: '/variants', label: '多平台变体', blurb: '各平台并行差异化文案', args: '[主题]' },
  { cmd: '/enhance', label: '优化提示词', blurb: '只增强提示，不填表', args: '[文本]' },
  { cmd: '/title', label: '设置标题', blurb: '直接写入表单标题', args: '<标题>' },
  { cmd: '/desc', label: '设置描述', blurb: '直接写入描述/正文', args: '<描述>' },
  { cmd: '/tags', label: '设置标签', blurb: '逗号分隔标签', args: 'a,b,c' },
  { cmd: '/mode', label: '切换模式', blurb: 'video 或 note', args: 'video|note' },
  { cmd: '/group', label: '选择分组', blurb: '按名称选账号分组', args: '<名称>' },
  { cmd: '/platform', label: '筛选平台', blurb: '在当前分组内筛平台', args: '抖音,小红书' },
  { cmd: '/schedule', label: '定时发布', blurb: '设发布时间', args: '明天 18:00' },
  { cmd: '/status', label: '查看状态', blurb: '模式 / 分组 / 文案摘要' },
  { cmd: '/publish', label: '提交发布', blurb: '触发左侧表单提交' },
  { cmd: '/skill', label: '加载 Skill', blurb: '注入平台写作规范', args: '<id>' },
  { cmd: '/skills', label: '列出 Skills', blurb: '查看可用 skill' },
  { cmd: '/apply', label: '应用上次', blurb: '把最近 AI 结果写入表单' },
  { cmd: '/clear', label: '清空对话', blurb: '重置当前会话' },
  { cmd: '/help', label: '帮助', blurb: '列出全部命令' },
]

const KNOWN_TOKENS = new Set([
  '/fullflow',
  '/variants',
  '/enhance',
  '/apply',
  '/clear',
  '/help',
  '/title',
  '/desc',
  '/tags',
  '/mode',
  '/group',
  '/platform',
  '/schedule',
  '/status',
  '/publish',
  '/submit',
  '/skills',
  '/skill',
])

// Avoid backticks inside string literals — Vite's oxc transform mis-parses them.
const HELP_TEXT = [
  '**AI 助手命令**（Claude Code 风格，输入 / 唤起）',
  '',
  '### 生成',
  '  /fullflow [主题]     增强 → 生成 → **自动填表**',
  '  /variants [主题]     多平台变体（可加 search 联网）',
  '  /enhance [文本]      只优化提示词',
  '  /apply               把上一次回复写入表单',
  '',
  '### 表单控制',
  '  /title <标题>        设置标题',
  '  /desc <描述>         设置描述',
  '  /tags a,b,c          设置标签',
  '  /mode video|note     切换视频 / 图文',
  '  /group <名称>        选择账号分组',
  '  /platform 抖音,小红书 筛选平台',
  '  /schedule 明天 18:00 定时（或 now / YYYY-MM-DD HH:MM）',
  '  /status              查看当前状态',
  '  /publish             提交发布（同 /submit）',
  '',
  '### Skill',
  '  /skills              列出 skill',
  '  /skill douyin-upload 加载 skill 风格（后续生成生效）',
  '',
  '### 会话',
  '  /clear               清空对话',
  '  /help                本帮助',
  '',
  '也可以直接用自然语言，例如：',
  '  「写一条抖音美食文案」·「切换到图文」·「选择全能组」·「现在发布」',
].join('\n')

export const MAGIC_HELP_TEXT = HELP_TEXT

/**
 * Parse a leading-slash command. Non-slash input returns
 * `{ kind: 'error', reason: '不以 / 开头' }` so the runtime can fall through
 * to natural-language / free chat.
 */
export function parseMagicCommand(rawText: string): MagicCommand {
  const text = rawText.trim()
  if (!text.startsWith('/')) {
    return { kind: 'error', reason: '不以 / 开头', input: rawText }
  }

  const firstToken = text.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const rest = text.slice(firstToken.length).trim()

  if (!KNOWN_TOKENS.has(firstToken)) {
    return { kind: 'error', reason: `未知命令：${firstToken}（输入 /help 查看）`, input: rawText }
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
    case '/title':
      return rest
        ? { kind: 'title', text: rest }
        : { kind: 'error', reason: '/title 需要标题文本', input: rawText }
    case '/desc':
      return rest
        ? { kind: 'desc', text: rest }
        : { kind: 'error', reason: '/desc 需要描述文本', input: rawText }
    case '/tags':
      return rest
        ? { kind: 'tags', text: rest }
        : { kind: 'error', reason: '/tags 需要至少一个标签', input: rawText }
    case '/mode': {
      const m = rest.toLowerCase()
      if (m === 'video' || m === '视频' || m === 'v') return { kind: 'mode', mode: 'video' }
      if (m === 'note' || m === '图文' || m === 'n' || m === 'image') return { kind: 'mode', mode: 'note' }
      return { kind: 'error', reason: '/mode 仅支持 video 或 note', input: rawText }
    }
    case '/group':
      return rest
        ? { kind: 'group', query: rest }
        : { kind: 'error', reason: '/group 需要分组名称', input: rawText }
    case '/platform':
      return rest
        ? { kind: 'platform', raw: rest }
        : { kind: 'error', reason: '/platform 需要平台名，如 抖音,小红书', input: rawText }
    case '/schedule':
      return rest
        ? { kind: 'schedule', when: rest }
        : { kind: 'error', reason: '/schedule 需要时间，如 明天 18:00 或 now', input: rawText }
    case '/status':
      return { kind: 'status' }
    case '/publish':
    case '/submit':
      return { kind: 'publish' }
    case '/skills':
      return { kind: 'skills' }
    case '/skill':
      return rest
        ? { kind: 'skill', query: rest }
        : { kind: 'skills' }
    default:
      return { kind: 'error', reason: 'internal: unknown token', input: rawText }
  }
}

function parseVariants(rest: string): {
  kind: 'variants'
  topic: string
  search: boolean
} {
  const flagMatch = rest.match(/^(search|--search(?:=(true|false))?)\b\s*/i)
  if (!flagMatch) {
    return { kind: 'variants', topic: rest.trim(), search: false }
  }
  const explicit = flagMatch[2]
  const search =
    explicit === undefined ? true : explicit.toLowerCase() === 'true'
  const body = rest.slice(flagMatch[0].length).trim()
  return { kind: 'variants', topic: body, search }
}

/**
 * High-confidence natural-language intents (no LLM). Returns null when
 * the text should go to free-form chat instead.
 */
export function parseNaturalIntent(rawText: string): MagicCommand | null {
  const text = rawText.trim()
  if (!text || text.startsWith('/')) return null

  // Mode switch
  if (/^(切换到?|改成|用)?\s*(图文|笔记|图文模式)/.test(text) || text === '图文') {
    return { kind: 'mode', mode: 'note' }
  }
  if (/^(切换到?|改成|用)?\s*(视频|视频模式)/.test(text) || text === '视频') {
    return { kind: 'mode', mode: 'video' }
  }

  // Select group: 「选择全能组」「用分组 xxx」
  const groupMatch = text.match(
    /^(?:选择|选用|切换到?|用)?\s*(?:分组|账号组)?\s*[「"']?(.+?)[」"']?\s*(?:分组|组)?$/,
  )
  if (
    groupMatch &&
    /分组|账号组|选择|选用/.test(text) &&
    groupMatch[1] &&
    groupMatch[1].length < 40
  ) {
    return { kind: 'group', query: groupMatch[1].replace(/(分组|组)$/, '').trim() }
  }
  const groupMatch2 = text.match(/^选择分组\s+(.+)$/)
  if (groupMatch2?.[1]) return { kind: 'group', query: groupMatch2[1].trim() }

  // Publish
  if (
    /^(现在)?(发布|提交|开始发布|立刻发布|马上发布)$/.test(text) ||
    text === 'publish' ||
    text === 'submit'
  ) {
    return { kind: 'publish' }
  }

  // Status
  if (/^(查看)?(当前)?(状态|进度)$/.test(text) || text === 'status') {
    return { kind: 'status' }
  }

  // Clear chat
  if (/^(清空|清除)(对话|会话|聊天)?$/.test(text)) {
    return { kind: 'clear' }
  }

  // Schedule: 定时明天18点 / 定时 2026-01-01 12:00
  const sched = text.match(/^定时\s*(.+)$/)
  if (sched?.[1]) return { kind: 'schedule', when: sched[1].trim() }

  // Skill load
  const skillM = text.match(/^(?:加载|使用)\s*skill\s*[：:]?\s*(.+)$/i)
  if (skillM?.[1]) return { kind: 'skill', query: skillM[1].trim() }

  return null
}

/** Filter MAGIC_COMMANDS for slash autocomplete. */
export function filterSlashCommands(query: string): typeof MAGIC_COMMANDS {
  const q = query.replace(/^\//, '').toLowerCase()
  if (!q) return MAGIC_COMMANDS
  return MAGIC_COMMANDS.filter(
    (c) =>
      c.cmd.slice(1).startsWith(q) ||
      c.label.includes(query.replace(/^\//, '')) ||
      c.blurb.includes(query.replace(/^\//, '')),
  )
}

export function buildMagicCommandMessage(command: MagicCommand): ChatMessage {
  let content = ''
  switch (command.kind) {
    case 'fullflow':
      content = command.topic
        ? `🚀 **一键全流程** —「${command.topic}」\n增强 → 生成 → 自动填表`
        : `🚀 **一键全流程**\n增强 → 生成 → 自动填表`
      break
    case 'variants':
      content = command.topic
        ? command.search
          ? `🌐🎨 **多平台变体** —「${command.topic}」（启用联网）`
          : `🎨 **多平台变体** —「${command.topic}」`
        : command.search
          ? `🌐🎨 **多平台变体**（启用联网）`
          : `🎨 **多平台变体**`
      break
    case 'enhance':
      content = command.text
        ? `✨ **提示词增强** —「${command.text}」`
        : `✨ **提示词增强**`
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
    case 'title':
      content = `✏️ 标题 → **${command.text}**`
      break
    case 'desc':
      content = `✏️ 描述已更新（${command.text.slice(0, 40)}${command.text.length > 40 ? '…' : ''}）`
      break
    case 'tags':
      content = '🏷️ 标签 → ' + command.text
      break
    case 'mode':
      content = `🔀 模式 → **${command.mode === 'video' ? '视频' : '图文'}**`
      break
    case 'group':
      content = `👥 选择分组「${command.query}」…`
      break
    case 'platform':
      content = `📱 筛选平台：${command.raw}`
      break
    case 'schedule':
      content = `⏰ 定时：${command.when}`
      break
    case 'status':
      content = `📋 查询状态…`
      break
    case 'publish':
      content = `🚀 **提交发布**…`
      break
    case 'skills':
      content = formatSkillsHelp()
      break
    case 'skill':
      content = `🧩 加载 skill「${command.query}」…`
      break
    case 'error':
      content =
        '❌ **命令错误**：' +
        command.reason +
        '\n\n输入 /help 查看可用命令。\n可用 skill：' +
        PUBLISH_SKILLS.map((s) => s.id).join(', ')
      break
  }
  return {
    id: crypto.randomUUID(),
    role: 'system',
    content,
    createdAt: Date.now(),
  }
}

/**
 * Parse loose schedule strings into `YYYY-MM-DDTHH:mm` local (form format).
 * Supports: now, 明天 18:00, 今天 20:30, 2026-07-28 15:00, 2026-07-28T15:00
 */
export function parseScheduleWhen(when: string): string | null {
  const w = when.trim()
  if (!w) return null
  if (/^(now|立即|马上)$/i.test(w)) {
    const d = new Date()
    d.setMinutes(d.getMinutes() + 5)
    return toLocalInput(d)
  }
  // ISO-ish
  const iso = w.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/)
  if (iso) {
    const hh = iso[2].padStart(2, '0')
    return `${iso[1]}T${hh}:${iso[3]}`
  }
  const tomorrow = w.match(/^明天\s*(\d{1,2})(?::|：|点)?(\d{2})?/)
  if (tomorrow) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(Number(tomorrow[1]), Number(tomorrow[2] ?? '0'), 0, 0)
    return toLocalInput(d)
  }
  const today = w.match(/^今天\s*(\d{1,2})(?::|：|点)?(\d{2})?/)
  if (today) {
    const d = new Date()
    d.setHours(Number(today[1]), Number(today[2] ?? '0'), 0, 0)
    return toLocalInput(d)
  }
  return null
}

function toLocalInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${hh}:${mm}`
}
