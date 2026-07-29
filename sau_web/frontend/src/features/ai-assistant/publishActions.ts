/**
 * Actions the publish page exposes to the AI assistant so slash commands
 * and natural-language intents can drive the real UI (mode, group,
 * schedule, submit) — not just fill title/desc/tags.
 */
import type { AccountGroup } from '@/api/types'
import { NOTE_PLATFORMS, PLATFORMS } from '@/api/types'
import type { GroupSelection } from '@/features/publish/GroupPublishSelector'
import type { FormHandle } from '@/lib/chat/chatFormBridge'

export type PublishMode = 'video' | 'note'

export interface PublishAiActions {
  mode: PublishMode
  setMode: (mode: PublishMode) => void
  groups: AccountGroup[]
  selection: GroupSelection | null
  setSelection: (selection: GroupSelection | null) => void
  formRef: { current: FormHandle | null }
}

const NOTE_SET = new Set(NOTE_PLATFORMS.map((p) => p.value))

/** Build a GroupSelection covering every auth in the group (mode-filtered). */
export function selectionFromGroup(
  group: AccountGroup,
  mode: PublishMode,
  platformFilter?: string[],
): GroupSelection | null {
  let auths = group.authorizations ?? []
  if (mode === 'note') {
    auths = auths.filter((a) => NOTE_SET.has(a.platform))
  }
  if (platformFilter && platformFilter.length > 0) {
    const want = new Set(platformFilter)
    auths = auths.filter((a) => want.has(a.platform))
  }
  if (auths.length === 0) return null
  return {
    groupId: group.id,
    groupName: group.name,
    platforms: [...new Set(auths.map((a) => a.platform))],
    mappings: auths.map((a) => ({
      platform: a.platform,
      cookieFile: a.cookie_file ?? '',
      authId: a.id,
      valid: a.valid,
      stale: a.stale,
    })),
  }
}

export function findGroupByQuery(
  groups: AccountGroup[],
  query: string,
): AccountGroup | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined
  return (
    groups.find((g) => g.name.toLowerCase() === q) ??
    groups.find((g) => g.name.toLowerCase().includes(q))
  )
}

/** Resolve platform aliases: 抖音 → douyin, xhs → xiaohongshu, etc. */
export function resolvePlatformIds(raw: string): string[] {
  const tokens = raw
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const t of tokens) {
    const lower = t.toLowerCase()
    const hit = PLATFORMS.find(
      (p) =>
        p.value === lower ||
        p.label === t ||
        p.label.toLowerCase() === lower ||
        p.value.includes(lower),
    )
    // common aliases
    const alias: Record<string, string> = {
      抖音: 'douyin',
      dy: 'douyin',
      快手: 'kuaishou',
      ks: 'kuaishou',
      小红书: 'xiaohongshu',
      xhs: 'xiaohongshu',
      红书: 'xiaohongshu',
      b站: 'bilibili',
      bilibili: 'bilibili',
      视频号: 'tencent',
      微信: 'tencent',
      youtube: 'youtube',
      yt: 'youtube',
      tiktok: 'tiktok',
    }
    const id = hit?.value ?? alias[lower] ?? alias[t]
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

export function formatStatus(actions: PublishAiActions): string {
  const snap = (() => {
    try {
      return actions.formRef.current?.getFormSnapshot() ?? null
    } catch {
      return null
    }
  })()
  const lines = [
    '**当前发布状态**',
    '',
    `- 模式：${actions.mode === 'video' ? '视频' : '图文'}`,
    `- 分组：${actions.selection?.groupName ?? '（未选）'}`,
    `- 平台：${actions.selection?.platforms?.join(', ') || '（未选）'}`,
    `- 标题：${snap?.title?.trim() || '（空）'}`,
    `- 描述：${snap?.desc?.trim() ? snap.desc.trim().slice(0, 80) + (snap.desc.length > 80 ? '…' : '') : '（空）'}`,
    `- 标签：${snap?.tags?.length ? snap.tags.join(', ') : '（空）'}`,
  ]
  return lines.join('\n')
}
