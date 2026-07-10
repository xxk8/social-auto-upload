// ──────────────────────────────────────────────────────────────────────────
// features/preferences/tabs/OverviewTab.tsx
//
// Round-OPT-3G+ v2.5 (tile summaries, overflow-safe). The "at-a-glance"
// jump-off surface for the PreferencesDialog.
//
// Three sections:
//
//   1. **Inline theme picker** — the ONLY real interactive switch
//      in the dialog. Inlined here so changing theme doesn't force
//      a tab navigation. PersonalizationTab renders the SAME picker
//      (full-canvas disclosure) so a click in either surface flows
//      through the shared `useTheme()` hook and updates both at once.
//
//   2. **Tile summaries** — 4 cards in a 2x2 grid (1-col on narrow
//      modals), each card renders 3-4 InfoRow shortcut rows
//      (density="compact" — py-2 + text-[13px]) that LITERALLY
//      FLATTEN the corresponding source tab's settings into one
//      glance. Per-tile row schema (round-OPT-3G+ v2.5):
//
//      • Account       → 邮箱 / 角色 / 显示名 / 最近登录
//      • Settings      → 套餐 / 价格 / 已包含 / 相关页面
//      • Personalization → 主题 / 1 stub-marker row ("更多偏好即将上线")
//      • About         → 应用名 / 版本 / Git SHA / 描述
//
//      v2.5 design pin: NO icon on any summary row. Earlier v2
//      rendered <LinkIcon /> on Settings "相关页面" — it looked
//      clickable but the row wasn't a <Link>; affordance was a lie.
//      Dropped. If a future round makes these rows into real
//      links, re-introduce an icon together with the link.
//
//      v2.5 design pin: stub rows (紧凑度/语言) collapsed into a
//      single trailing "更多偏好设置即将上线" muted row on the
//      Personalization tile only. Earlier v2 rendered two stub
//      rows that visually paralleled working rows, which misled
//      readers counting available settings. Honest placeholder
//      beats silent omission AND multiple misleading stubs.
//
//   3. **Jump-off CTA** — each tile keeps a bottom-right CTA that
//      calls `openPreferences(tab)` to switch the active tab
//      WITHOUT closing the modal.
//
// data-testid invariants (round-OPT-3G+ v2.5):
//   • Tile card root:     `preferences-overview-tile-${tab}`
//   • Tile jump CTA:      `preferences-overview-tile-${tab}-cta`
//   • Per-row InfoRow:    `preferences-overview-tile-${tab}-row-${rowKey}`
//                          where `rowKey` is a stable machine key
//                          (NOT the Chinese label) so an i18n
//                          migration (邮箱 → E-mail) doesn't blast
//                          the test surface. The display label
//                          still renders as the Chinese eyebrow.
//                          Row-data lives on `data-row-key=${rowKey}`
//                          for downstream tooling.
// ──────────────────────────────────────────────────────────────────────────

import {
  ArrowRight,
  Info,
  Settings as SettingsIcon,
  Sun,
  User,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/Components/ui/card'
import { Button } from '@/Components/ui/button'
import { useAuth } from '@/features/auth/useAuth'
import { useTheme } from '@/Components/ThemeProvider.helpers'
import { usePreferencesDialog } from '../PreferencesDialogProvider'
import type { PreferencesTab } from '../PreferencesDialogProvider.helpers'
import { ThemeModesRadio } from '../shared/theme-modes'
import { InfoRow } from '../shared/info-row'

type TierKey = 'free' | 'pro' | 'legacy'

const TIER_NAME: Record<TierKey, string> = {
  free: '自由版',
  pro: '专业版',
  legacy: '社区版',
}

const TIER_PRICE: Record<TierKey, string> = {
  free: '¥0 / 永久免费',
  pro: '¥99 / 月',
  legacy: '感谢您的早期支持',
}

const TIER_FEATURES: Record<TierKey, string[]> = {
  free: [
    '多账号统一管理（≤ 6 个）',
    '视频内容发布',
    '运行日志 + 数据分析',
  ],
  pro: [
    '多账号统一管理（≤ 30 个）',
    'AI 自动生成（200 次 / 月）',
    '数据分析窗口延长至 90 天',
  ],
  legacy: [
    '包含自由版所有功能',
    '历史数据永久保留',
    '升级至专业版可享首月半价',
  ],
}

const THEME_LABEL: Record<string, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
}

export function OverviewTab() {
  const { user: authUser } = useAuth()
  const { theme, setTheme } = useTheme()
  const { openPreferences } = usePreferencesDialog()

  // `as TierKey` — `authUser.tier` from useAuth widens to
  // `string`, so the literal union must be enforced here.
  const tierKey = (authUser?.tier ?? 'legacy') as TierKey

  const appName =
    (import.meta.env.VITE_APP_NAME as string | undefined) ??
    'social-auto-upload'
  const appVersion =
    (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'unknown'
  const buildSha =
    (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? 'dev'

  const tierName = TIER_NAME[tierKey] ?? TIER_NAME.legacy
  const tierPrice = TIER_PRICE[tierKey] ?? TIER_PRICE.legacy
  const tierFeatureCount = (TIER_FEATURES[tierKey] ?? TIER_FEATURES.legacy).length
  const themeLabel = THEME_LABEL[theme] ?? theme

  return (
    <div className="space-y-4">
      {/* ── Inline theme picker (canonical shared source) ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sun className="h-4 w-4" />
            </span>
            主题外观
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeModesRadio
            theme={theme}
            setTheme={setTheme}
            size="compact"
            testId="overview-theme-modes"
            hideCaption
          />
        </CardContent>
      </Card>

      {/* ── Jump-off tiles (4 tiles, 2x2 grid) ─────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <JumpTile
          openPreferences={openPreferences}
          tab="account"
          label="账户"
          Icon={User}
          rows={[
            { rowKey: 'email', label: '邮箱', value: authUser?.email ?? '—' },
            {
              rowKey: 'role',
              label: '角色',
              value: authUser?.role === 'admin' ? '管理员' : '用户',
            },
            {
              rowKey: 'displayName',
              label: '显示名',
              value:
                authUser?.name && authUser.name.trim() !== ''
                  ? authUser.name
                  : '—',
            },
            {
              rowKey: 'lastLogin',
              label: '最近登录',
              value: authUser?.last_login ?? '—',
              mono: true,
            },
          ]}
        />
        <JumpTile
          openPreferences={openPreferences}
          tab="settings"
          label="套餐与设置"
          Icon={SettingsIcon}
          rows={[
            { rowKey: 'tier', label: '套餐', value: tierName },
            { rowKey: 'price', label: '价格', value: tierPrice },
            {
              rowKey: 'features',
              label: '已包含',
              value: `${tierFeatureCount} 项特色`,
              hint: '订阅管理 + 跨页面跳转',
            },
            {
              rowKey: 'related',
              label: '相关页面',
              value: '运行日志 · 数据分析',
              hint: '打开设置查看完整跳转',
            },
          ]}
        />
        <JumpTile
          openPreferences={openPreferences}
          tab="personalization"
          label="个性化"
          Icon={Sun}
          rows={[
            { rowKey: 'theme', label: '主题', value: themeLabel },
            // Single trailing stub marker (round-OPT-3G+ v2.5).
            // Replaces the prior two stub rows (密度/语言) that
            // visually paralleled working rows. Honest
            // placeholder + visually distinct (entire row is a
            // muted hint line, no separate value).
            {
              rowKey: 'more',
              label: '更多偏好',
              value: '即将上线',
              hint: '紧凑度 + 语言切换 planned',
            },
          ]}
        />
        <JumpTile
          openPreferences={openPreferences}
          tab="about"
          label="关于此应用"
          Icon={Info}
          rows={[
            { rowKey: 'appName', label: '应用名', value: appName },
            { rowKey: 'version', label: '版本', value: appVersion, mono: true },
            { rowKey: 'sha', label: 'Git SHA', value: buildSha, mono: true },
            {
              rowKey: 'description',
              label: '描述',
              value: '多平台视频自动发布',
              hint: 'i18n: zh-CN · EN planned',
            },
          ]}
        />
      </div>
    </div>
  )
}

interface JumpTileProps {
  /** Memoized setter from usePreferencesDialog(); passed in once so
   *  4 tiles don't each re-call the hook. */
  openPreferences: (tab: PreferencesTab) => void
  tab: PreferencesTab
  label: string
  Icon: typeof User
  /** 3-4 InfoRow instances (compact density) flatten the source tab. */
  rows: TileRow[]
}

interface TileRow {
  /** Stable machine key used in data-testid (NOT the i18n label)
   *  so an i18n migration doesn't blast the test surface. */
  rowKey: string
  /** i18n display label (Chinese today; will be swapped to the
   *  i18n key string when the dialog learns i18n). */
  label: string
  value: string
  hint?: string
  mono?: boolean
}

function JumpTile({
  openPreferences,
  tab,
  label,
  Icon,
  rows,
}: JumpTileProps) {
  return (
    <Card
      data-testid={`preferences-overview-tile-${tab}`}
      className="transition-all duration-200 hover:ring-foreground/20 hover:shadow-md"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-[14px] flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col">
          {rows.map((row) => (
            <InfoRow
              // Stable testId using rowKey (NOT label) so i18n
              // doesn't blast the test surface.
              key={row.rowKey}
              testId={`preferences-overview-tile-${tab}-row-${row.rowKey}`}
              label={row.label}
              value={row.value}
              hint={row.hint}
              mono={row.mono}
              density="compact"
            />
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => openPreferences(tab)}
          aria-label={`打开 ${label} 设置`}
          className="w-full justify-between gap-1.5 group/cta"
          data-testid={`preferences-overview-tile-${tab}-cta`}
        >
          <span>打开 {label}</span>
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/cta:translate-x-0.5" />
        </Button>
      </CardContent>
    </Card>
  )
}
