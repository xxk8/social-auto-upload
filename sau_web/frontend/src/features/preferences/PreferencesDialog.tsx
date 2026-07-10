// ──────────────────────────────────────────────────────────────────────────
// preferences/PreferencesDialog.tsx
//
// Round-opt-prefs-dialog v4 (slice extraction): renamed from
// `Components/PreferencesDialog.tsx` to live alongside the dialog
// provider + the per-tab body components. Any shell — desktop
// sidebar (UserMenu), mobile AppBar (UserMenu mode="mobile"),
// future command-palette — can now drop in
// `<PreferencesDialogProvider><PreferencesDialog /></PreferencesDialogProvider>`
// without reaching into `Components/` for the dialog body.
//
// Round-OPT-prefs-dialog (v3): the v2 dialog was a hand-rolled
// `<nav>` of `<button>` elements with manual `aria-current="page"`
// marking the active tab. v3 replaced that with Radix's
// `<Tabs.Root>` so we inherit the WAI-ARIA APG tabs pattern
// instead of re-implementing it:
//
//   • `<Tabs.List role="tablist">` wrapper with explicit
//     `aria-orientation="vertical"` (left rail stack). Per APG,
//     vertical tablists bind ArrowDown / ArrowUp ONLY (Left/Right
//     are reserved for navigating between separate tablists on
//     the same page). Radix wires that mapping automatically.
//   • `<Tabs.Trigger role="tab">` per tab with Radix-managed
//     `aria-selected` (replaces our manual `aria-current="page"`
//     — `aria-current` is reserved for navigational links, tabs
//     use `aria-selected`).
//   • `activationMode="automatic"` — focus moves + content swap
//     together (matches the existing click-to-swap behavior so
//     the body is always one arrow-key away).
//   • Roving tabindex: only the active tab has `tabindex=0`,
//     others `-1`. Tab key from outside lands on the active tab
//     once; then Arrow keys cycle.
//   • `<Tabs.Content role="tabpanel">` per pane — auto unmounts
//     inactive panes (`forceMount={false}`), so the DOM has
//     exactly one body in tree at a time.
//
// data-testid invariants preserved so existing tests (a)–(q) keep
// pinning the same selectors:
//   • `preferences-dialog`        — DialogContent panel
//   • `preferences-dialog-nav`    — Tabs.List
//   • `preferences-tab-${id}`     — Tabs.Trigger
//   • `preferences-tab-${id}-indicator` — amber left strip driven
//                                    by HTML `hidden={!isActive}`
//   • `preferences-dialog-content` — Tabs.Root
//   • `preferences-dialog-tab-header` — inside active Tabs.Content
//   • data-tab-header / data-tab-body — driven by the active pane
//                                    data-tab attribute
//
// Round-3 condense:
//   • Click-outside-to-close is Radix Dialog's default
//     `onPointerDownOutside` → onOpenChange(false) →
//     closePreferences. Production-invariant documented in
//     Comments at the top of this file.
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
import { Dialog, DialogContent, DialogTitle } from '@/Components/ui/dialog'
import { Button } from '@/Components/ui/button'
import { cn } from '@/lib/utils'
import {
  usePreferencesDialog,
} from './PreferencesDialogProvider'
import type { PreferencesTab } from './PreferencesDialogProvider.helpers'

import { useAuth } from '@/features/auth/useAuth'
import { OverviewTab } from './tabs/OverviewTab'
import { AccountTab } from './tabs/AccountTab'
import { SettingsTab } from './tabs/SettingsTab'
import { PersonalizationTab } from './tabs/PersonalizationTab'
import { AboutTab } from './tabs/AboutTab'

// Layout (cold-neutral + single sodium-amber accent):
//   ┌──────────┬─────────────────────────────────────┐
//   │ 偏好设置 │  账户                                │  ← TabMeta header
//   │ ─      ─ │  查看账号信息与活动记录              │
//   │ ▎账户    │ ───────────────────────────────── │
//   │   设置   │                                      │
//   │   个性化 │  [Active tab body — AccountTab /    │
//   │   关于   │   SettingsTab / PersonalizationTab / │
//   │          │   AboutTab]                          │
//   │          │                                      │
//   │          ├────────────────────────────────────  │
//   │          │                       [ 退出 ]    ✕ │
//   └──────────┴─────────────────────────────────────┘

interface TabMeta {
  id: PreferencesTab
  label: string
  description: string
  Icon: typeof User
}

// Round-OPT-3G+ (Overview up-front): the Overview tile-grid is the
// left-MOST nav item because "show me everything at once" is the
// most common operator intent. The 4 source tabs (账户 / 设置 /
// 个性化 / 关于) remain below as full-canvas surfaces for the
// "drill into X" path. TABS array order IS the nav order IS the
// keyboard cycling order — keep these three consistent.
const TABS: ReadonlyArray<TabMeta> = [
  { id: 'overview', label: '概览', Icon: LayoutGrid, description: '一键跳转所有偏好设置' },
  { id: 'account', label: '账户', Icon: User, description: '查看账号信息与活动记录' },
  { id: 'settings', label: '设置', Icon: SettingsIcon, description: '管理订阅套餐与跨页面跳转' },
  { id: 'personalization', label: '个性化', Icon: Sun, description: '外观与显示偏好' },
  { id: 'about', label: '关于', Icon: Info, description: '应用元数据与社区信息' },
] 

export function PreferencesDialog() {
  const { open, activeTab, setActiveTab, closePreferences } = usePreferencesDialog()
  const { logout } = useAuth()

  const handleLogout = async () => {
    // Close the dialog FIRST (synchronously) so a session-loss
    // flash isn't visible before the navigate-to-/ side-effect
    // commits. Errors propagate to mutation onError — we DO NOT
    // wrap in try/catch per project "no defensive try/catch".
    closePreferences()
    await logout()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closePreferences() }}>
      <DialogContent
        // Modal sizing — 80vw, hard cap at 1100 px. Inner grid is
        // exact-pixel-sized (`grid-cols-[200px_1fr]` +
        // `sm:h-[min(70vh,640px)]`), so overflow-hidden clamps
        // inner content from leaking past the rounded corners
        // during the slide-in / zoom-in animation.
        className="w-[80vw] sm:max-w-[1100px] gap-0 p-0 overflow-hidden border-border/40 shadow-2xl"
        data-testid="preferences-dialog"
      >
        <Tabs.Root
          // VALUE is CONTROLLED from usePreferencesDialog (the
          // dialog's `activeTab` state); onValueChange writes back.
          // This invariant lets ANY code in the app push the tab
          // forward — see UserMenu.tsx `openPreferences(id)`.
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as PreferencesTab)}
          // Vertical orientation: ArrowDown / ArrowUp navigate
          // (per APG vertical-tab rule). Left/Right is intentionally
          // NOT rebound so it can navigate between sibling tablists
          // on the page if/when one is added below this.
          orientation="vertical"
          // Auto-activation: focus moves + body swap together.
          activationMode="automatic"
          data-testid="preferences-dialog-content"
          className="grid grid-cols-[220px_1fr] sm:h-[min(70vh,640px)] h-[calc(100vh-2rem)] outline-none"
        >
          {/* ── Left nav (Radix tablist) ───────────────────────────
              Trigger text-ink and icon-ink use
              `data-[state=...]:` variants (happy-dom evaluates
              them reliably — test e locks this). The
              <preferences-tab-${id}-indicator> span inside the
              trigger uses HTML `hidden` instead because happy-dom
              intermittently misses CSS-display variants. */}
          <Tabs.List
            aria-label="偏好设置"
            data-testid="preferences-dialog-nav"
            className="border-r border-border/40 bg-muted/20 px-3 py-4 flex flex-col gap-1"
          >
            {/* Brand lockup — `>_` terminal glyph (the only brand
                mark per DESIGN.md) + `sau@main` mono wordmark + a
                secondary 偏好设置 eyebrow. Replaces the prior
                floating uppercase label so the dialog carries the
                same identity as the sidebar / login card. */}
            <div className="px-3 pb-4 mb-2 border-b border-border/40">
              <div className="flex items-center gap-2.5 px-2 pt-1">
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] bg-foreground font-mono text-sm font-semibold leading-none text-background"
                >
                  {'>_'}
                </span>
                <DialogTitle className="flex flex-col leading-tight text-left">
                  <span className="font-mono text-[13px] font-medium tracking-tight text-foreground">
                    sau@main
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                    偏好设置
                  </span>
                </DialogTitle>
              </div>
            </div>

            {TABS.map(({ id, label, Icon }) => {
              // Per-tab `isActive` drives the indicator's
              // HTML `hidden` attribute. Computed here so the
              // React closure has access to the parent's
              // `activeTab`.
              const isActive = activeTab === id
              return (
                <Tabs.Trigger
                  key={id}
                  value={id}
                  data-testid={`preferences-tab-${id}`}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 outline-none h-9 px-3',
                    'focus-visible:ring-2 focus-visible:ring-ring/40',
                    // Active row: subtle amber accent wash (NOT a
                    // foreground block fill — design-system rule) +
                    // full-ink text. The 2px amber left strip in the
                    // span below carries the active signal. No
                    // drop-shadow on the flat surface (DESIGN forbids
                    // shadows on flat chrome).
                    'data-[state=active]:text-foreground data-[state=active]:font-semibold data-[state=active]:bg-primary/[0.08]',
                    'data-[state=inactive]:text-muted-foreground hover:text-foreground hover:bg-primary/[0.04]',
                  )}
                >
                  {/* Active-row indicator — sidebar-active-row
                      pattern per DESIGN.md (2-px sodium-amber
                      strip + full-ink text, NO
                      bg-foreground/[0.08] block fill).
                      Visibility is controlled via the HTML
                      `hidden` attribute (which the DOM spec
                      maps to `display: none`) rather than a
                      Tailwind/CSS variant selector — happy-dom
                      intermittently misses CSS variants like
                      `hidden + data-[...]:block` but always
                      honors the spec-defined `hidden` attribute. */}
                  <span
                    aria-hidden
                    hidden={!isActive}
                    data-testid={`preferences-tab-${id}-indicator`}
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-5 rounded-r-full bg-primary"
                  />
                  <Icon className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    'text-muted-foreground/70 group-data-[state=active]:text-primary group-hover:text-foreground',
                  )} />
                  <span className="truncate">{label}</span>
                </Tabs.Trigger>
              )
            })}
          </Tabs.List>

          {/* ── Right content (active pane + persistent footer) ── */}
          <div className="flex flex-1 min-w-0 flex-col bg-background h-full min-h-0">
            {TABS.map(({ id, label, description, Icon }) => (
              <Tabs.Content
                key={id}
                value={id}
                data-tab-body={id}
                className="flex-1 min-h-0 overflow-y-auto px-7 py-6 outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {/* TabMeta header — title + description for the
                    active tab. Mounted BEFORE the body so context
                    appears first in the scrolling flow. The icon
                    chip mirrors the OverviewTab / nav-icon pattern
                    (bg-primary/10 + primary ink) so the selected
                    tab reads as one cohesive surface across the
                    rail and the content pane. */}
                <div
                  data-testid="preferences-dialog-tab-header"
                  data-tab={id}
                  className="mb-5 flex items-start gap-3 pb-4 border-b border-border/30"
                >
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold tracking-tight text-foreground">
                      {label}
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">
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

            {/* Footer band — 退出 button bottom-right persists
                across tab swaps. */}
            <div className="flex items-center justify-end gap-2 px-7 py-3.5 border-t border-border/40 bg-muted/20">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                data-testid="preferences-dialog-logout"
                className="gap-1.5"
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
