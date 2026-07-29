import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/useAuth'
import { ROUTES } from '@/routes'
// Round-OPT-prefs-dialog v5 (barrel migration): collapsed the
// sub-path import into a single barrel import from
// `@/features/preferences`. The barrel re-exports
// `usePreferencesDialog` + `type PreferencesTab` alongside the
// public `<PreferencesDialogProvider />` component + the 4 tabs,
// keeping UserMenu's import surface at the slice level.
import {
  usePreferencesDialog,
  type PreferencesTab,
} from '@/features/preferences'

interface UserMenuProps {
  /**
   * Avatar size + dropdown placement:
   * - `expanded` (40-px avatar, side=top, align=end): the dashboard's
   *   expanded-mode sidebar footer. Menu opens ABOVE the trigger
   *   (avatar sits at the bottom of the sidebar), aligned to the
   *   trigger's right edge.
   * - `collapsed` (32-px avatar, side=right, align=center): the 60-px
   *   collapsed rail. Menu opens to the RIGHT of the trigger
   *   (rail is too narrow for `top`), vertically centered on the
   *   trigger.
   * - `mobile` (32-px avatar, side=bottom, align=end): the mobile
   *   ≤768px top-header AppBar (AppShell.isMobile branch). Menu
   *   opens BELOW the trigger (the avatar sits at the top-right
   *   corner of the viewport, so side=top or side=right would
   *   overflow the screen) and right-aligned with the trigger so
   *   the long side of the menu drops over the page content with
   *   a clean right-edge seam.
   *
   * `mobile` shares the `h-8 w-8` envelope with `collapsed` so the
   * avatar reads as one consistent identity marker across all three
   * modes. Visual differentiation comes only from the trigger's
   * surrounding surface (sidebar rail vs AppBar), not from the
   * trigger itself.
   *
   * Testid is deliberately per-mode (`user-menu-trigger-{expanded|
   * collapsed|mobile}`), NOT a shared `compact` testid even though
   * `collapsed` and `mobile` share the envelope. This is a
   * semantic split — observability + integration tests use it to
   * distinguish the 60-px sidebar rail from the AppBar so a future
   * "consolidation" that flattens the testids would silently trip
   * the AppShell-level integration tests (none exist today, but
   * the testid is forward-declared here so any future
   * selector-based test lands on the right surface).
   *
   * The trigger's visual envelope is preserved AT REST from the prior
   * inline avatar (different per mode group — see triggerClassName
   * below). Click affordances (cursor-pointer + hover shift + focus-
   * visible ring) are layered on top; they never override the
   * underlying background/ring/text contrast that the dashboard
   * chrome relies on for hierarchy.
   */
  mode?: 'expanded' | 'collapsed' | 'mobile'
}

// User-menu avatar initial — sourced from the authed user's name
// (preferred) or email local-part's first character. Falls back to
// `S` when both are null.
function userInitial(user: { name?: string | null; email?: string | null } | null | undefined): string {
  const source = user?.name || user?.email
  return source?.[0]?.toUpperCase() ?? 'S'
}

// Round-OPT-prefs-dialog: the 4 nav items historically used
// `<Link to="/dashboard/...">` to navigate to full route-mounted pages.
// The round-OPT-footer v3 user-menu follow-up comment in App.tsx
// chose routes over dialog "so deep-link sharing / back-button /
// browser-history all behave normally". Round-OPT-prefs-dialog
// reverses that decision: UserMenu clicks now open a center-stage
// modal (PreferencesDialog) over the current page. The 4 routes
// still work for direct URL hits (browser refresh, share-link,
// browser address-bar typing) — they mount the same Page, which
// re-uses PreferencesContent so the two surfaces stay in
// lockstep. The dialog never pushes history state, so closing
// the dialog does NOT yank the user backwards in their nav
// stack.
const PREFERENCE_ITEMS: ReadonlyArray<{ id: PreferencesTab; label: string }> = [
  { id: 'account', label: '账户' },
  { id: 'settings', label: '设置' },
  { id: 'personalization', label: '个性化' },
  { id: 'about', label: '关于' },
]

export function UserMenu({ mode = 'expanded' }: UserMenuProps) {
  const { user: authUser, logout } = useAuth()
  const { openPreferences } = usePreferencesDialog()
  const navigate = useNavigate()
  // Logout clears the authed session and bounces the visitor back to the
  // public landing page. Same shape as the now-removed standalone
  // `handleLogout` in AppShell.tsx (the AppShell sidebar footer's
  // standalone button used to call the same pair). Radix DropdownMenu
  // auto-closes on item click via internal focus management, so we don't
  // need to call `setOpen(false)` explicitly.
  const handleLogout = useCallback(async () => {
    await logout()
    navigate({ to: ROUTES.public.landing as never })
  }, [logout, navigate])
  const isCollapsed = mode === 'collapsed'
  const isMobile = mode === 'mobile'
  // Trigger envelope is shared between `collapsed` and `mobile` (both
  // are 32-px compact treatments) so the avatar reads as one identity
  // marker across the two compact surfaces. `expanded` keeps its own
  // 40-px gradient + primary ring.
  const isCompact = isCollapsed || isMobile

  // Trigger visual envelope is mode-distinct:
  //   compact (collapsed OR mobile)
  //     → bg-muted/50 + NO ring (matches the Adjacent <ThemeToggle />
  //       default h-8 w-8 so the pair reads as the same icon button
  //       vocabulary on both the collapsed rail AND the mobile AppBar).
  //   expanded
  //     → bg-gradient-to-br + 2-px primary/10 ring + flex-shrink-0
  //       (mirrors the round-OPT-footer v3 inlined avatar pixel-for-
  //       pixel at rest on the 260-px sidebar).
  // Click affordances added on top of either envelope:
  //   cursor-pointer, transition-all, outline-none, focus-visible
  //   ring (mode-keyed to either ring-1 ring-ring [compact] or
  //   ring-primary/50 [expanded to match the existing 2-px primary
  //   ring]).
  const triggerClassName = cn(
    'rounded-full flex items-center justify-center transition-all outline-none cursor-pointer',
    isCompact
      ? 'h-8 w-8 bg-muted/50 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-primary/20'
      : 'h-10 w-10 flex-shrink-0 bg-gradient-to-br from-primary/20 to-primary/5 ring-2 ring-primary/10 hover:ring-primary/30 focus-visible:ring-primary/50',
  )

  // Inner glyph also mode-distinct — same pixel-for-pixel mirror of
  // the prior inlined spans (text-xs muted-foreground for compact
  // modes, text-[15px] primary for expanded).
  const glyphClassName = cn(
    'leading-none',
    isCompact
      ? 'text-xs font-medium text-muted-foreground'
      : 'text-[15px] font-semibold text-primary',
  )

  const triggerTestId = isMobile
    ? 'user-menu-trigger-mobile'
    : isCollapsed
    ? 'user-menu-trigger-collapsed'
    : 'user-menu-trigger-expanded'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={authUser?.name ? `用户菜单 · ${authUser.name}` : authUser?.email ? `用户菜单 · ${authUser.email}` : '用户菜单'}
          title="用户菜单"
          data-testid={triggerTestId}
          className={triggerClassName}
        >
          {/* Round 7 — avatar branch: when the authed user has set
              an `avatar` URL (via PATCH /api/auth/me on the profile
              surface), render <img src> instead of the email-initial
              letter glyph. Falls back to the letter so legacy users
              (avatar=null) read unchanged. The img uses
              `object-cover` so any aspect-ratio avatar crops cleanly
              inside the round envelope without distorting the
              trigger geometry. `alt=""` is decorative — the
              aria-label above carries the accessible name so
              screen-reader users hear "用户菜单 · email" rather than
              the avatar URL. */}
          {authUser?.avatar ? (
            <img
              src={authUser.avatar}
              alt=""
              className="h-full w-full rounded-full object-cover"
              data-testid="user-menu-avatar-img"
            />
          ) : (
            <span className={glyphClassName} data-testid="user-menu-avatar-glyph">
              {userInitial(authUser)}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        // Avatar sits at the TOP-right of the mobile viewport, so
        // side=top or side=right would overflow the screen. The
        // thinker's recommended AppBar convention: side=bottom so
        // the menu drops below the trigger over the page content,
        // and align=end so its right edge follows the trigger's
        // right edge (no overflow on narrow viewports).
        //
        // Z-index contract: shadcn's <DropdownMenuContent> defaults
        // to `z-50`, which matches BOTH the mobile top-header
        // (`sticky top-0 z-50` — App.tsx) AND the mobile bottom-nav
        // (`fixed bottom-0 ... z-50` — App.tsx). The portal
        // currently wins by DOM order because Radix appends to
        // `document.body` AFTER the React root div, so in the
        // body-level stacking context the portal-child renders LAST
        // among z-50 siblings and overlays them correctly. This is
        // ACCIDENTAL and fragile — bump either App.tsx sibling to
        // z-[60]+ (e.g. a sticky banner above the bottom-nav, a
        // modal layer above the header) and the dropdown will
        // silently render behind it. If you change z-index on any
        // App.tsx mobile sibling, also bump the local
        // `dropdown-menu.tsx` content's `z-50` to `z-[60]` in
        // lockstep.
        side={isMobile ? 'bottom' : isCollapsed ? 'right' : 'top'}
        align={isCollapsed ? 'center' : 'end'}
        sideOffset={isMobile || isCollapsed ? 8 : 12}
        className="min-w-[220px]"
        data-testid={`user-menu-content-${mode}`}
      >
        <DropdownMenuLabel className="font-normal py-2">
          <span className="block text-[11px] text-muted-foreground/70 uppercase tracking-widest font-mono">
            已登录为
          </span>
          <span className="block text-sm text-foreground truncate mt-0.5">
            {authUser?.name || authUser?.email || '管理员'}
          </span>
          <span className="block text-[11px] text-muted-foreground/70 mt-0.5">
            {authUser?.role === 'admin' ? '管理员' : '用户'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PREFERENCE_ITEMS.map(({ id, label }) => (
          // Inline <button> (NOT a Radix `asChild` link) because
          // the action is "open dialog", not "navigate to URL".
          // Data-testid carries the tab id so the dialog's
          // openPreferences(id) call site is verifier-friendly.
          <DropdownMenuItem
            key={id}
            onClick={() => openPreferences(id)}
            data-testid={`user-menu-open-preferences-${id}`}
            className="cursor-pointer"
          >
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleLogout}
          data-testid="user-menu-logout"
          className="cursor-pointer text-muted-foreground hover:text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-3.5 w-3.5" aria-hidden />
          登出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
