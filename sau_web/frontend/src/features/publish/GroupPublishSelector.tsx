import { memo, useCallback, useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/Components/ui/index'
import {PlatformIcon} from '@/Components/ui/platform-icon';
import {PLATFORM_BORDER_LEFT} from '@/Components/ui/platform-icon.helpers';import { cn } from '@/lib/utils'
import { toneChipClasses, toneFillBgClass, toneRingClass } from '@/lib/tone'
import { Layers, CheckCircle2, Users, ChevronRight, Sparkles, LogIn } from 'lucide-react'
import type { AccountGroup } from '@/api/client'
import { PLATFORMS, NOTE_PLATFORMS } from '@/api/client'
import { LoginProgressModal } from '@/Components/LoginProgressModal'

/**
 * OPT-3G — the three platforms that have dedicated, conditional
 * accordion sections in the wizard's advanced options (商品链接
 * for 抖音 / 分区 for Bilibili / 短标题 for 视频号). Indexed by the
 * same `platform` key the api/client surface uses so plumbing is
 * type-safe end-to-end.
 *
 * Owned here (GroupPublishSelector) rather than in VideoForm so the
 * chip — the canonical producer that surfaces `pendingPlatformConfigs`
 * to the parent — sits beside the union it produces. VideoForm and
 * ContentStep both re-import from this module.
 */
export type PlatformSpecificSection = 'douyin' | 'bilibili' | 'tencent'

export type PlatformAccountMapping = {
  platform: string
  cookieFile: string
  authId: number
}

export type GroupSelection = {
  groupId: number
  groupName: string
  platforms: string[]
  mappings: PlatformAccountMapping[]
}

type GroupPublishSelectorProps = {
  groups: AccountGroup[]
  mode: 'video' | 'note'
  value: GroupSelection | null
  onChange: (selection: GroupSelection | null) => void
  /**
   * OPT-3G: handler invoked when the user clicks the
   * "💡 N 项平台专属待配置" chip next to the summary line.
   * PublishPage wires this up to BOTH open VideoForm's
   * controlled "advanced" Accordion AND highlight the matching
   * platform-specific section.
   *
   * The platform argument is the first pending config the chip
   * computed from the current `value.platforms`. Publishers can
   * extend the chip to highlight several platforms later, but
   * today the UI prioritises one section at a time so the ring
   * is unambiguous.
   */
  onExpandAdvanced?: (platform: PlatformSpecificSection) => void
}

/** Platforms that support note uploads. */
const NOTE_PLATFORM_SET = new Set(NOTE_PLATFORMS.map((p) => p.value))

/**
 * OPT-3H: local relogin intent. Holds everything the click handler must
 * pass to the modal without re-querying the `groups` prop. The OLD cookie
 * path is intentionally NOT carried here; both a11y sites (sr-only span
 * + button `title`) read `auth.cookie_file` directly from the parent
 * closure, which keeps the click handler the single source of truth for
 * the per-row data the modal will consume.
 */
type ReloginTarget = {
  groupId: number
  groupName: string
  platform: string
  platformLabel: string
}

// Platform border-left classes are now sourced from
// `@/Components/ui/platform-icon`'s `PLATFORM_BORDER_LEFT` (SSOT with
// `PLATFORM_COLORS`). See platform-icon.tsx → migration note (OPT-1B-2).

export const GroupPublishSelector = memo(function GroupPublishSelector({
  groups,
  mode,
  value,
  onChange,
  onExpandAdvanced,
}: GroupPublishSelectorProps) {
  const navigate = useNavigate()
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    value?.groupId ?? null,
  )

  // Stable platforms grid label id — `useId()` per instance, prefix
  // stripped of `:` so the resulting id is alphanumeric and survives
  // a CSS-selector query. Avoids DOM-id collision when two selectors
  // are co-mounted (Dev Tools, multi-account dashboards, tests).
  const platformsLabelId = `wizard-platforms-label-${useId().replace(/:/g, '')}`

  // Mobile: collapse the platform checkbox list after selection to save
  // ~250-350px of vertical space. Users tap "点击修改" to expand.
  const [platformsExpanded, setPlatformsExpanded] = useState(false)

  // OPT-3H: holds the失效 row whose modal is currently showing. `null`
  // when no relogin flow is in flight. After success / error / dismiss,
  // the local LoginProgressModal's `onComplete` clears this back to null.
  const [reloginTarget, setReloginTarget] = useState<ReloginTarget | null>(null)

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  )

  const availableAuths = useMemo(() => {
    if (!selectedGroup) return []
    return selectedGroup.authorizations.filter((a) =>
      mode === 'note' ? NOTE_PLATFORM_SET.has(a.platform) : true,
    )
  }, [selectedGroup, mode])

  const platformLabelMap = useMemo(
    () => Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label])),
    [],
  )

  const checkedPlatforms = useMemo(
    () => new Set(value?.platforms ?? []),
    [value?.platforms],
  )

  const allChecked =
    availableAuths.length > 0 &&
    availableAuths.every((a) => checkedPlatforms.has(a.platform))

  // ── handlers ──────────────────────────────────────────────────────────

  const handleGroupChange = useCallback(
    (groupIdStr: string) => {
      const gid = Number(groupIdStr)
      setSelectedGroupId(gid)
      setPlatformsExpanded(false)
      const group = groups.find((g) => g.id === gid)
      if (!group) {
        onChange(null)
        return
      }
      const auths = group.authorizations.filter((a) =>
        mode === 'note' ? NOTE_PLATFORM_SET.has(a.platform) : true,
      )
      const platforms = auths.map((a) => a.platform)
      const mappings: PlatformAccountMapping[] = auths.map((a) => ({
        platform: a.platform,
        cookieFile: a.cookie_file,
        authId: a.id,
      }))
      onChange({ groupId: group.id, groupName: group.name, platforms, mappings })
    },
    [groups, mode, onChange],
  )

  const handleTogglePlatform = useCallback(
    (platform: string) => {
      if (!selectedGroup) return
      const next = new Set(checkedPlatforms)
      if (next.has(platform)) next.delete(platform)
      else next.add(platform)

      const auths = availableAuths.filter((a) => next.has(a.platform))
      const mappings: PlatformAccountMapping[] = auths.map((a) => ({
        platform: a.platform,
        cookieFile: a.cookie_file,
        authId: a.id,
      }))
      onChange({
        groupId: selectedGroup.id,
        groupName: selectedGroup.name,
        platforms: Array.from(next),
        mappings,
      })
    },
    [selectedGroup, checkedPlatforms, availableAuths, onChange],
  )

  const handleToggleAll = useCallback(() => {
    if (!selectedGroup) return
    if (allChecked) {
      onChange({
        groupId: selectedGroup.id,
        groupName: selectedGroup.name,
        platforms: [],
        mappings: [],
      })
    } else {
      const platforms = availableAuths.map((a) => a.platform)
      const mappings: PlatformAccountMapping[] = availableAuths.map((a) => ({
        platform: a.platform,
        cookieFile: a.cookie_file,
        authId: a.id,
      }))
      onChange({ groupId: selectedGroup.id, groupName: selectedGroup.name, platforms, mappings })
    }
  }, [selectedGroup, allChecked, availableAuths, onChange])

  // OPT-3H: open the relogin modal for a失效 row. Reads from the passed-in
  // `auth` directly so callers (the失效 badge <button>) don't have to
  // touch upstream lookup. `e.stopPropagation()` isolates the badge click
  // from the surrounding `auth-row` click which would otherwise toggle
  // the platform checkbox — we want relogin to be an independent intent.
  const handleReloginClick = useCallback(
    (
      e: React.MouseEvent<HTMLButtonElement>,
      auth: { id: number; platform: string; cookie_file: string },
    ) => {
      e.stopPropagation()
      if (!selectedGroup) return
      setReloginTarget({
        groupId: selectedGroup.id,
        groupName: selectedGroup.name,
        platform: auth.platform,
        platformLabel: platformLabelMap[auth.platform] ?? auth.platform,
      })
    },
    [selectedGroup, platformLabelMap],
  )

  const handleReloginComplete = useCallback(() => {
    // Modal's own `onOpenChange(false)` already fires; we just drop the
    // local intent so a fresh click on the same row re-opens with a
    // clean state. Query invalidation is handled by the
    // `useAuthorizeAccountGroup` / `useConfirmAuthorizeAccountGroup`
    // hooks inside LoginProgressModal — no extra refetch needed here.
    setReloginTarget(null)
  }, [])

  const groupsWithAuths = useMemo(
    () => groups.filter((g) => g.authorizations.length > 0),
    [groups],
  )

  // OPT-3G: pending platform-specific configuration count. Reads from
  // `value.platforms` (the user-checked set) so chip + count always
  // match what is actually queued. Note: 只在 video 模式下计数 —
  // NoteForm 上没有 advanced Accordion 接口，点击也不会起作用。
  const pendingPlatformConfigs = useMemo<
    PlatformSpecificSection[]
  >(() => {
    if (mode !== 'video') return []
    const items: PlatformSpecificSection[] = []
    const checked = value?.platforms ?? []
    if (checked.includes('douyin')) items.push('douyin')
    if (checked.includes('bilibili')) items.push('bilibili')
    if (checked.includes('tencent')) items.push('tencent')
    return items
  }, [mode, value?.platforms])
  const pendingPlatformConfigsCount = pendingPlatformConfigs.length

  const handleExpandAdvancedClick = useCallback(() => {
    if (!onExpandAdvanced) return
    if (pendingPlatformConfigs.length === 0) return
    // 默认高亮首个待配置平台。后续轮次可以循环（lastIdx + 1），但
    // 现在只点亮一个以免同一时刻多个 ring 重叠搶眼。
    onExpandAdvanced(pendingPlatformConfigs[0])
  }, [onExpandAdvanced, pendingPlatformConfigs])

  const checkedCount = value?.platforms.length ?? 0
  const totalCount = availableAuths.length

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="card-refined">
        <CardHeader className="pb-2 sm:pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
              <Layers className="h-4 w-4 text-muted-foreground" />
            </div>
            <span>选择发布账号组</span>
            {value && checkedCount > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                {checkedCount}/{totalCount} 平台
              </span>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2 sm:space-y-3">
          {/* Group selector — 账号分组是 required。仅下拉框本身用
              `<Label htmlFor>` 配对；后置 `*` 走视觉必填信号。
              SR-only 「必填」把定位信号补到屏幕阅读器上 —
              `aria-hidden` 让 * 对 AT 不可见，因此必须有等价的
              sr-only 旁路。 */}
          <div className="space-y-1.5">
            <Label htmlFor="publish-group-select" className="text-xs text-muted-foreground flex items-center gap-1">
              账号分组
              <span className="text-primary" aria-hidden="true">*</span>
              <span className="sr-only">（必填）</span>
            </Label>
            <Select
              value={selectedGroupId != null ? String(selectedGroupId) : ''}
              onValueChange={handleGroupChange}
            >
              <SelectTrigger id="publish-group-select" className="w-full">
                <SelectValue placeholder="选择一个账号分组…" />
              </SelectTrigger>
              <SelectContent>
                {groupsWithAuths.length === 0 ? (
                  <div className="px-2 py-6 text-sm text-muted-foreground text-center space-y-3">
                    <p>暂无可用分组，请先在账号管理中创建</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate('/app/accounts')}
                    >
                      前往账号管理 →
                    </Button>
                  </div>
                ) : (
                  groupsWithAuths.map((group) => {
                    const pValues = group.authorizations.map((a) => a.platform)
                    const invalidCount = group.authorizations.filter((a) => !a.valid).length
                    return (
                      <SelectItem key={group.id} value={String(group.id)}>
                        <span className="flex items-center gap-2">
                          <Users className="h-3.5 w-3.5 text-muted-foreground/60" />
                          <span className="font-medium">{group.name}</span>
                          <span className="flex items-center gap-0.5 ml-1">
                            {pValues.slice(0, 4).map((p) => (
                              <PlatformIcon key={p} platform={p} className="h-3 w-3" />
                            ))}
                            {pValues.length > 4 && (
                              <span className="text-[10px] text-muted-foreground">+{pValues.length - 4}</span>
                            )}
                          </span>
                          <span className="text-muted-foreground text-[11px]">
                            ({group.authorizations.length})
                          </span>
                          {invalidCount > 0 && (
                            <span
                              className={cn(
                                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0',
                                toneChipClasses('warning'),
                              )}
                              aria-label={`${invalidCount} 个平台 cookie 已失效`}
                            >
                              <span
                                className={cn('w-1 h-1 rounded-full', toneFillBgClass('warning'))}
                                aria-hidden="true"
                              />
                              {invalidCount} 失效
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    )
                  })
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Platform list */}
          <AnimatePresence mode="wait">
            {selectedGroup && availableAuths.length > 0 && (
              <motion.div
                key={selectedGroupId}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-2 overflow-hidden"
              >
                {/* ── Mobile collapsed summary ──────────────────────── */}
                {!platformsExpanded && value && checkedCount > 0 && (
                  <div
                    className="flex sm:hidden items-center justify-between px-3 py-2.5 rounded-lg border border-border/50 bg-muted/40 cursor-pointer active:scale-[0.98] transition"
                    onClick={() => setPlatformsExpanded(true)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setPlatformsExpanded(true) }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[12px] font-medium shrink-0">已选 {checkedCount}/{totalCount} 平台</span>
                      <span className="text-muted-foreground/30 text-[12px]">·</span>
                      <div className="flex items-center gap-1 overflow-hidden">
                        {value.platforms.slice(0, 5).map((p) => (
                          <PlatformIcon key={p} platform={p} className="h-3.5 w-3.5 shrink-0" />
                        ))}
                      </div>
                    </div>
                    <span className="text-[11px] text-primary shrink-0">点击修改</span>
                  </div>
                )}

                {/* Full platform grid — always on desktop, toggle on mobile */}
                <div className={cn('space-y-2', !platformsExpanded && 'hidden sm:block')}>
                <div className="flex items-center justify-between">
                  <span
                    id={platformsLabelId}
                    className="text-xs text-muted-foreground"
                  >
                    发布平台
                  </span>
                  <div className="flex items-center gap-1">
                    {platformsExpanded && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] text-muted-foreground sm:hidden"
                        onClick={() => setPlatformsExpanded(false)}
                      >
                        收起
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] text-muted-foreground"
                      onClick={handleToggleAll}
                    >
                      {allChecked ? '取消全选' : '全选'}
                    </Button>
                  </div>
                </div>

                <div
                  role="group"
                  aria-labelledby={platformsLabelId}
                  className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
                >
                  {availableAuths.map((auth, idx) => {
                    const checked = checkedPlatforms.has(auth.platform)
                    const label = platformLabelMap[auth.platform] ?? auth.platform
                    const borderCls = PLATFORM_BORDER_LEFT[auth.platform] ?? 'border-l-primary/50'

                    return (
                      <motion.div
                        key={auth.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * 0.03 }}
                        className={cn(
                          'auth-row auth-row-compact border-l-[3px] cursor-pointer select-none',
                          borderCls,
                          checked
                            ? 'bg-muted/60'
                            : 'hover:bg-muted/30',
                        )}
                        onClick={() => handleTogglePlatform(auth.platform)}
                      >
                        <div className="relative flex-shrink-0">
                          <Checkbox
                            id={`platform-ck-${auth.id}`}
                            name={`platform-${auth.platform}`}
                            checked={checked}
                            onCheckedChange={() => handleTogglePlatform(auth.platform)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>

                        <PlatformIcon platform={auth.platform} className="h-4 w-4 shrink-0" />

                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-sm font-medium truncate">{label}</span>
                          <span className="text-[11px] text-muted-foreground/50 truncate font-mono">
                            {auth.cookie_file.split('/').pop()?.replace('.json', '') ?? ''}
                          </span>
                        </div>

                        {checked && (
                          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                        )}

                        {/* OPT-3H: 失效 badge is now a button.
                            - Same visual treatment as before (warning chip +
                              pulsing dot) to avoid disrupting long-time
                              readers.
                            - click opens LoginProgressModal in-place; SSE
                              flow handles the cookie reissue end-to-end.
                            - `e.stopPropagation()` prevents the surrounding
                              row from firing `handleTogglePlatform` —
                              relogin and platform-check are independent.
                            - `aria-label` includes the cookie_file path so
                              keyboard / screen-reader users can identify
                              the auth being recovered. */}
                        {!auth.valid && (
                          <>
                          <button
                            type="button"
                            onClick={(e) => handleReloginClick(e, auth)}
                            aria-label={`重新登录 ${label}`}
                            aria-describedby={`ausr-cookie-path-${auth.id}`}
                            title={`cookie: ${auth.cookie_file} · 点击重新登录`}
                            className={cn(
                              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 cursor-pointer',
                              'hover:brightness-110 active:scale-[0.97] transition',
                              // 隐藏原生 outline（避免与自定义 ring 同位叠加
                              // 双圈点）. `toneRingClass('warning')` 提供
                              // WARNING 色调环 — ring-2 + offset-1 在
                              // high-contrast / 系统强制颜色模式下都可识别.
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                              toneRingClass('warning'),
                              toneChipClasses('warning'),
                            )}
                          >
                              <span
                                className={cn('w-1 h-1 rounded-full status-running', toneFillBgClass('warning'))}
                                aria-hidden="true"
                              />
                              <LogIn className="h-2.5 w-2.5" aria-hidden="true" />
                              失效
                            </button>
                            {/* OPT-3H: hidden description for screen readers.
                                  `sr-only` keeps it visually hidden while
                                  letting assistive tech consume the full
                                  cookie path. Id format `ausr-cookie-path-{auth.id}`
                                  ensures uniqueness across rows. */}
                            <span
                              id={`ausr-cookie-path-${auth.id}`}
                              className="sr-only"
                            >
                              cookie 文件路径：{auth.cookie_file}
                            </span>
                          </>
                        )}
                      </motion.div>
                    )
                  })}
                </div>

                {/* Summary */}
                {value && checkedCount > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5 rounded-lg bg-muted/40 border border-border/50 px-3 py-2.5 text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">将发布到</span>
                      <span className="font-semibold text-foreground">{checkedCount} 个平台</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                      <div className="flex items-center gap-1 flex-wrap min-w-0">
                        {value.platforms.map((p) => (
                          <span
                            key={p}
                            className="inline-flex items-center gap-1 rounded bg-background border border-border/60 px-1.5 py-0.5 text-[11px] font-medium"
                          >
                            <PlatformIcon platform={p} className="h-3 w-3" />
                            {platformLabelMap[p] ?? p}
                          </span>
                        ))}
                      </div>
                    </div>
                    {/*
                      OPT-3G: 平台专属待配置 chip.
                      - Shows only in video mode (NoteForm lacks the
                        advanced Accordion + hasDouyin/hasBilibili/hasTencent
                        sections, so the chip would dangle).
                      - Click bubbles through `onExpandAdvanced` so the
                        parent (PublishPage) can both open the Accordion
                        AND pin the highlight ring on the matching
                        platform section.
                      - emoji-prefix copy is intentional — 给长期用户保留
                        “平台““抖音”“商品链接”的心智模型；提示轻量。
                    */}
                    {mode === 'video' && pendingPlatformConfigsCount > 0 && onExpandAdvanced && (
                      <button
                        type="button"
                        onClick={handleExpandAdvancedClick}
                        aria-label={`扩展高级选项，配置 ${pendingPlatformConfigsCount} 项平台专属`}
                        title={`点击展开“高级选项”并定位“${pendingPlatformConfigs[0]}”平台专属设置`}
                        data-testid="pending-platform-configs-chip"
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer',
                          'bg-blue-50 text-blue-700 border border-blue-200',
                          'hover:bg-blue-100 hover:border-blue-300 active:scale-[0.97] transition',
                          'dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
                        )}
                      >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        <span>{pendingPlatformConfigsCount} 项平台专属待配置</span>
                        <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
                      </button>
                    )}
                  </div>
                )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {selectedGroup && availableAuths.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              该分组暂无{mode === 'note' ? '支持图文的' : ''}已授权平台
            </p>
          )}
        </CardContent>
      </Card>

      {/* OPT-3H: in-place relogin modal — modal is owned by this component,
          not by the page, so the click-to-recover intent stays local. The
          modal's existing `useAuthorizeAccountGroup` /
          `useConfirmAuthorizeAccountGroup` hooks already invalidate
          `['account-groups']` on success, so the失效 row flips to valid
          automatically without an explicit refetch from us. */}
      <LoginProgressModal
        open={reloginTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReloginTarget(null)
        }}
        groupId={reloginTarget?.groupId ?? 0}
        groupName={reloginTarget?.groupName ?? ''}
        platform={reloginTarget?.platform ?? ''}
        platformLabel={reloginTarget?.platformLabel ?? ''}
        onComplete={handleReloginComplete}
      />
    </motion.div>
  )
})
