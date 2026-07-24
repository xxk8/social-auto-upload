// ──────────────────────────────────────────────────────────────────────────
// preferences/PreferencesDialog.tsx
//
// Horizontal top-tab layout (2026-07): replaces the left rail with a
// top tab strip so more horizontal space goes to the tab body.
//
// data-testid invariants (preserved for PreferencesDialog.test.tsx):
//   • preferences-dialog
//   • preferences-dialog-nav          — Tabs.List
//   • preferences-tab-${id}           — Tabs.Trigger
//   • preferences-tab-${id}-indicator — active underline (hidden={!isActive})
//   • preferences-dialog-content      — Tabs.Root
//   • preferences-dialog-tab-header
//   • preferences-dialog-logout
// ──────────────────────────────────────────────────────────────────────────

import {
  LayoutGrid,
  LogOut,
  Info,
  Settings as SettingsIcon,
  Sun,
  User,
} from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { usePreferencesDialog } from './PreferencesDialogProvider'
import type { PreferencesTab } from './PreferencesDialogProvider.helpers'

import { useAuth } from '@/features/auth/useAuth'
import { OverviewTab } from './tabs/OverviewTab'
import { AccountTab } from './tabs/AccountTab'
import { SettingsTab } from './tabs/SettingsTab'
import { PersonalizationTab } from './tabs/PersonalizationTab'
import { AboutTab } from './tabs/AboutTab'

interface TabMeta {
  id: PreferencesTab
  label: string
  description: string
  Icon: typeof User
}

const TABS: ReadonlyArray<TabMeta> = [
  { id: 'overview', label: '概览', Icon: LayoutGrid, description: '一键跳转所有偏好设置' },
  { id: 'account', label: '账户', Icon: User, description: '查看账号信息与活动记录' },
  { id: 'settings', label: '设置', Icon: SettingsIcon, description: '管理订阅套餐与跨页面跳转' },
  { id: 'personalization', label: '个性化', Icon: Sun, description: '外观、密度与语言' },
  { id: 'about', label: '关于', Icon: Info, description: '应用元数据与社区信息' },
]

export function PreferencesDialog() {
  const { open, activeTab, setActiveTab, closePreferences } = usePreferencesDialog()
  const { logout } = useAuth()

  const handleLogout = async () => {
    closePreferences()
    await logout()
  }

  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closePreferences() }}>
      <DialogContent
        className="flex w-[92vw] max-w-[920px] flex-col gap-0 overflow-hidden border-border/50 p-0 shadow-2xl shadow-foreground/10 sm:w-[80vw]"
        data-testid="preferences-dialog"
      >
        <Tabs.Root
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as PreferencesTab)}
          // Horizontal: ArrowLeft / ArrowRight cycle tabs (APG).
          orientation="horizontal"
          activationMode="automatic"
          data-testid="preferences-dialog-content"
          className="flex h-[min(78vh,680px)] flex-col outline-none"
        >
          {/* ── Top chrome: brand + horizontal tabs ─────────────── */}
          <div className="shrink-0 border-b border-border/40 bg-muted/20">
            <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground font-mono text-[13px] font-semibold leading-none text-background"
              >
                {'>_'}
              </span>
              <DialogTitle className="flex flex-col text-left leading-tight">
                <span className="font-mono text-[13px] font-medium tracking-tight text-foreground">
                  sau@main
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">
                  偏好设置
                </span>
              </DialogTitle>
            </div>

            <Tabs.List
              aria-label="偏好设置"
              data-testid="preferences-dialog-nav"
              className="flex gap-0.5 overflow-x-auto px-3 pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {TABS.map(({ id, label, Icon }) => {
                const isActive = activeTab === id
                return (
                  <Tabs.Trigger
                    key={id}
                    value={id}
                    data-testid={`preferences-tab-${id}`}
                    className={cn(
                      'group relative flex h-10 shrink-0 items-center gap-1.5 px-3.5 text-[13px] font-medium outline-none transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-1',
                      'data-[state=active]:font-semibold data-[state=active]:text-foreground',
                      'data-[state=inactive]:text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 transition-colors',
                        'text-muted-foreground/65 group-data-[state=active]:text-primary',
                      )}
                    />
                    <span className="truncate">{label}</span>
                    {/* Active underline — bottom edge (horizontal layout).
                        HTML `hidden` keeps happy-dom / e2e selectors stable. */}
                    <span
                      aria-hidden
                      hidden={!isActive}
                      data-testid={`preferences-tab-${id}-indicator`}
                      className="absolute inset-x-2 bottom-0 h-[2.5px] rounded-t-full bg-primary"
                    />
                  </Tabs.Trigger>
                )
              })}
            </Tabs.List>
          </div>

          {/* ── Body ─────────────────────────────────────────────── */}
          <div className="flex min-h-0 flex-1 flex-col bg-background">
            {TABS.map(({ id, label, description, Icon }) => (
              <Tabs.Content
                key={id}
                value={id}
                data-tab-body={id}
                className="min-h-0 flex-1 overflow-y-auto px-5 py-5 outline-none focus-visible:ring-1 focus-visible:ring-ring sm:px-7 sm:py-6"
              >
                <div
                  data-testid="preferences-dialog-tab-header"
                  data-tab={id}
                  className="mb-5 flex items-start gap-3 border-b border-border/30 pb-4"
                >
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                      {label}
                    </h2>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                      {description}
                    </p>
                  </div>
                </div>

                {id === 'overview' && <OverviewTab />}
                {id === 'account' && <AccountTab />}
                {id === 'settings' && <SettingsTab />}
                {id === 'personalization' && <PersonalizationTab />}
                {id === 'about' && <AboutTab />}
              </Tabs.Content>
            ))}

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/35 bg-muted/15 px-5 py-3 sm:px-7">
              <p className="hidden text-[11px] text-muted-foreground/55 sm:block">
                {activeMeta.label} · 更改即时保存到本机
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                data-testid="preferences-dialog-logout"
                className="ml-auto gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
                退出
              </Button>
            </div>
          </div>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  )
}
