/**
 * Publish preflight checks — pure helpers used by ReviewStep before
 * submitting upload tasks. Blocking issues stop submit; warnings are
 * advisory (yellow).
 */

import type { GroupSelection, PlatformAccountMapping } from './GroupPublishSelector'

export type PreflightSeverity = 'error' | 'warning' | 'ok'

export type PreflightItem = {
  id: string
  severity: PreflightSeverity
  label: string
  /** Optional fix hint shown under the label. */
  hint?: string
}

export type PublishPreflightInput = {
  mode: 'video' | 'note'
  title: string
  hasMedia: boolean
  groupSelection: GroupSelection | null
  /** Optional body length for soft limits. */
  bodyLength?: number
  /** Title max length (default 100, matches ContentStep counter). */
  titleMax?: number
}

const DEFAULT_TITLE_MAX = 100

function mappingHealth(m: PlatformAccountMapping): 'invalid' | 'stale' | 'ok' {
  if (m.valid === false) return 'invalid'
  if (m.stale) return 'stale'
  return 'ok'
}

/**
 * Build ordered preflight checklist. First blocking error wins for
 * submit-gate messaging; UI can list all items.
 */
export function buildPublishPreflight(input: PublishPreflightInput): PreflightItem[] {
  const titleMax = input.titleMax ?? DEFAULT_TITLE_MAX
  const items: PreflightItem[] = []
  const title = input.title.trim()

  if (!input.groupSelection || input.groupSelection.platforms.length === 0) {
    items.push({
      id: 'platforms',
      severity: 'error',
      label: '未选择目标平台',
      hint: '返回第 1 步勾选至少一个账号平台',
    })
  } else {
    items.push({
      id: 'platforms',
      severity: 'ok',
      label: `已选 ${input.groupSelection.platforms.length} 个平台`,
    })
  }

  if (!title) {
    items.push({
      id: 'title',
      severity: 'error',
      label: '标题未填写',
      hint: '返回上一步填写标题',
    })
  } else if (title.length > titleMax) {
    items.push({
      id: 'title',
      severity: 'error',
      label: `标题超长（${title.length}/${titleMax}）`,
      hint: '请缩短标题后再发布',
    })
  } else if (title.length >= Math.floor(titleMax * 0.9)) {
    items.push({
      id: 'title',
      severity: 'warning',
      label: `标题接近上限（${title.length}/${titleMax}）`,
    })
  } else {
    items.push({
      id: 'title',
      severity: 'ok',
      label: '标题已填写',
    })
  }

  if (!input.hasMedia) {
    items.push({
      id: 'media',
      severity: 'error',
      label: input.mode === 'video' ? '未上传视频' : '未添加图片',
      hint: '返回上传步骤选择媒体文件',
    })
  } else {
    items.push({
      id: 'media',
      severity: 'ok',
      label: input.mode === 'video' ? '视频已就绪' : '图片已就绪',
    })
  }

  const mappings = input.groupSelection?.mappings ?? []
  const invalid = mappings.filter((m) => mappingHealth(m) === 'invalid')
  const stale = mappings.filter((m) => mappingHealth(m) === 'stale')

  if (invalid.length > 0) {
    const names = invalid.map((m) => m.platform).join('、')
    items.push({
      id: 'cookie-invalid',
      severity: 'error',
      label: `${invalid.length} 个账号登录态失效（${names}）`,
      hint: '请到账号管理重新扫码登录，否则发布会失败',
    })
  } else if (stale.length > 0) {
    const names = stale.map((m) => m.platform).join('、')
    items.push({
      id: 'cookie-stale',
      severity: 'warning',
      label: `${stale.length} 个账号 Cookie 偏旧（${names}）`,
      hint: '建议先「一键检测」或重新登录后再发，降低失败率',
    })
  } else if (mappings.length > 0) {
    items.push({
      id: 'cookie',
      severity: 'ok',
      label: '账号登录态正常',
    })
  }

  if ((input.bodyLength ?? 0) === 0 && input.hasMedia && title) {
    items.push({
      id: 'body',
      severity: 'warning',
      label: input.mode === 'video' ? '简介为空' : '正文为空',
      hint: '空简介也能发，但补上描述通常更利于推荐',
    })
  }

  return items
}

export function preflightHasBlocking(items: PreflightItem[]): boolean {
  return items.some((i) => i.severity === 'error')
}

export function firstBlockingReason(items: PreflightItem[]): string | undefined {
  return items.find((i) => i.severity === 'error')?.label
}
