// Web-side skill registry for the publish AI assistant.
// Mirrors the monorepo skills/<name>/SKILL.md set so the chat surface can
// load platform-specific guidance without reading the filesystem
// (browser cannot open repo paths). Keep descriptions short - they are
// injected as system context when /skill <id> runs.

export interface PublishSkill {
  /** Matches skills/<id>/ folder name. */
  id: string
  /** Short Chinese label for menus. */
  label: string
  /** One-line blurb. */
  description: string
  /** Related platform values from PLATFORMS. */
  platforms: string[]
  /**
   * Context block injected into the next generation turn so the LLM
   * follows the skill's publishing conventions.
   */
  systemPrompt: string
}

export const PUBLISH_SKILLS: readonly PublishSkill[] = [
  {
    id: 'douyin-upload',
    label: '抖音上传',
    description: '抖音视频/图文：标题短、开场抓人、标签热门',
    platforms: ['douyin'],
    systemPrompt: [
      '你正在按「抖音上传 skill」写文案。',
      '约定：标题 ≤30 字、前 3 秒抓人、描述口语化、标签 3–6 个热门词。',
      '输出格式必须严格为：',
      '标题：…',
      '描述：…',
      '标签：tag1, tag2, tag3',
    ].join('\n'),
  },
  {
    id: 'xiaohongshu-upload',
    label: '小红书上传',
    description: '小红书种草：真诚、分点、emoji 适度',
    platforms: ['xiaohongshu'],
    systemPrompt: [
      '你正在按「小红书上传 skill」写种草文案。',
      '约定：标题带情绪词、正文分点、真诚不硬广、标签含场景词。',
      '输出格式必须严格为：',
      '标题：…',
      '描述：…',
      '标签：tag1, tag2, tag3',
    ].join('\n'),
  },
  {
    id: 'kuaishou-upload',
    label: '快手上传',
    description: '快手：接地气、口语、节奏快',
    platforms: ['kuaishou'],
    systemPrompt: [
      '你正在按「快手上传 skill」写文案。',
      '约定：口语化、接地气、节奏快、少用书面语。',
      '输出格式必须严格为：',
      '标题：…',
      '描述：…',
      '标签：tag1, tag2, tag3',
    ].join('\n'),
  },
  {
    id: 'bilibili-upload',
    label: 'B站上传',
    description: 'Bilibili：信息密度、分区感、系列感',
    platforms: ['bilibili'],
    systemPrompt: [
      '你正在按「B站上传 skill」写文案。',
      '约定：标题可带【】分区感、描述信息密度高、可提系列/章节。',
      '输出格式必须严格为：',
      '标题：…',
      '描述：…',
      '标签：tag1, tag2, tag3',
    ].join('\n'),
  },
  {
    id: 'youtube-upload',
    label: 'YouTube 上传',
    description: 'YouTube：英文友好、SEO、CTA',
    platforms: ['youtube'],
    systemPrompt: [
      'You are writing under the YouTube upload skill.',
      'Conventions: clear title, SEO keywords in description, end with a light CTA.',
      'Output EXACTLY in this Chinese-key format (values may be English):',
      '标题：…',
      '描述：…',
      '标签：tag1, tag2, tag3',
    ].join('\n'),
  },
]

export function findSkill(query: string): PublishSkill | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined
  return PUBLISH_SKILLS.find(
    (s) =>
      s.id === q ||
      s.id.includes(q) ||
      s.label.includes(query.trim()) ||
      s.platforms.some((p) => p === q || p.includes(q)),
  )
}

export function formatSkillsHelp(): string {
  const lines = [
    '**可用 Skill**（/skill <id> 加载，影响后续生成风格）',
    '',
    ...PUBLISH_SKILLS.map((s) => {
      return ['  /skill ', s.id, '  - ', s.label, ': ', s.description].join('')
    }),
    '',
    '也可用：/skills 列出本表。',
  ]
  return lines.join('\n')
}
