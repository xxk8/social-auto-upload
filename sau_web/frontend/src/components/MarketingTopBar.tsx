// ── MarketingTopBar — single source of truth for the 5 visitor-facing
//    marketing surfaces (`/`, `/pricing`, `/hotlist`, `/about`, `/login`).
//
// Why this exists: before this component, each of the 5 marketing pages
// inlined its own `<header className="sticky top-0 ...">` with subtly
// different items, different order, and different active-state logic.
// Visitors saw an inconsistent navigation surface — "首页 · 定价 · 热榜
// · 关于 · 登录" appearing in different orders on different pages made
// the chrome feel incoherent. This component locks the item set, the
// item order, and the active-state logic to one definition so the 5
// pages share it verbatim.
//
//   • Item order: 首页 · 定价 · 热榜 · 关于 · 登录 (then `<ThemeToggle />`).
//     The 登录 entry additionally carries `isCta: true` and renders as a
//     `<Button asChild variant="default">` so the conversion action visually
//     outranks the 4 informational text links. The CTA navigates directly
//     to `/login/auth` (the verification code form) and forwards any
//     inbound `?plan=` / `?intent=` search params so deep-links from
//     PricingPage tier cards and the contact-sales route survive the
//     bounce. This is the marketing-page conversion affordance — every
//     other surface (CTA section, hero, pricing tiers) reinforces it.
//   • Authed-state chrome: when `useAuth().isAuthenticated` is true, the
//     登录 CTA is replaced by a `<UserMenu mode="mobile" />` in the same
//     slot — reuses the canonical UserMenu component so the dropdown
//     content (4 preference tabs + 登出) is identical across
//     MarketingTopBar / AppShell sidebar footer / AppShell mobile
//     AppBar. `mode="mobile"` is the right pick because the trigger
//     sits at the top edge of the viewport (the dropdown drops
//     side=bottom); the AppShell sidebar footer uses
//     mode="expanded" / "collapsed" instead.
//   • Active item gets `aria-current="page"` + `text-foreground` (text
//     link) OR shadow-md upgrade (CTA visual — see className below).
//     The CTA's active-span covers both `/login` and `/login/...` (the
//     whole conversion flow), not just the rendered `to` path.
//   • Scroll-past-80px lifts the bottom hairline from `border-border/40`
//     to a single 1px `border-primary` accent — the same "you've
//     scrolled past the hero" signal the old per-page TopBars used.
//     Round-VISION-FIX: bumped from `border-primary/45` to full
//     `border-primary` after browser-use inspection caught the /45
//     opacity as perceptually invisible. Even at 100% opacity a 1px
//     primary line is visually understated, so this is purely a
//     signal-strength bump — same signal language, more saturation.
//   • The brand mark always links to `/` and renders on every page
//     (including `/`), where clicking it is a no-op (Vercel/Linear
//     pattern). Same-page Link clicks don't reset React Router state.
//
//   • Round-OPT-chrome-responsive — mobile breakpoint contract:
//     The full desktop chrome (brand label + 4 inline text links +
//     登录 CTA + compact ThemeToggle) is ~510-540 px wide per
//     layout-math estimate — exceeds 320 px (iPhone SE 1), 360 px
//     (Android baseline), 375 px (iPhone SE 2/6/7/8), and 414 px
//     (iPhone Plus) viewports. The contract below splits the chrome
//     into 3 responsive layers so visitors in those narrow buckets
//     see a comfortable fit:
//
//       - <sm (640 px):  brand-text label is hidden (`hidden sm:inline`
//                       on the BrandMark's `<span>`). Visitor sees
//                       the BrandMark icon only. Saves ~108 px on
//                       chrome width. Confirmed needed at 320 px
//                       and 360 px (browser-use 320×568 inspection).
//       - <md (768 px):  the 4 static nav links collapse into a
//                       single `<Menu />` icon button triggering a
//                       Radix DropdownMenu with the same 4 items
//                       as `<DropdownMenuItem>`. MarketingTopBar is
//                       the FIRST visitor-facing surface to use this
//                       pattern in this codebase; UserMenu is the
//                       existing DropdownMenu reference impl for
//                       portal / state semantics. Saves ~168-200 px
//                       on chrome width (depending on whether the
//                       trigger is icon-only or text+chevron).
//       - ≥md (768 px): full desktop layout — brand label + 4 inline
//                       nav links (each as text link) + CTA +
//                       ThemeToggle. The mobile menu wrapper
//                       carries `md:hidden` so MD+ visitors never
//                       see the trigger button.
//
//     ThemeToggle is rendered `size="compact"` (h-7 w-7 = 28 px)
//     EVERYWHERE, not just on mobile. Reasoning: matches the
//     AppShell sidebar footer envelope (v5 chrome-consolidation),
//     saves 4 px vs `size="default"` (h-8 w-8 = 32 px) at every
//     viewport, and the 4 px difference is imperceptible at
//     desktop. Net result: total chrome at 320 px ≈ 270 px
//     (28 brand + 8 nav padding + 32 menu + 94 CTA + 28 theme +
//     48 outer padding + 4 gaps) — fits the 320 px viewport with
//     50 px of margin to spare.
//
// NOT used on:
//   • `/login/auth` — the centered-card form is its own surface, no nav
//   • `/dashboard/*`     — authed shell renders AppShell's sidebar instead
//   • `/catalog`   — standalone design catalog, no nav chrome
//
// `aria-label={t('marketing.topbar.nav_label', '营销导航')}` disambiguates from AppShell's
// `<nav aria-label="主导航">` sidebar: two `<nav>` regions on the same
// HTML document need distinct labels per WAI-ARIA Authoring Practices.
// The aria-label is localized so screen-reader users on / with EN locale
// hear "Marketing navigation" instead of the zh-CN literal.
//
// Round-OPT-prefs-dialog-v7 (chrome composition):
//   The authed branch (`<UserMenu mode="mobile" />` when
//   `isAuthenticated`) is wrapped in <PreferencesDialogProvider>
//   + <PreferencesDialog> so UserMenu's 4 dropdown items
//   ("账户 / 设置 / 个性化 / 关于") can call `openPreferences(tab)`
//   without throwing "usePreferencesDialog must be used within a
//   PreferencesDialogProvider" on the public landing `/`. Mirrors
//   the AppShell-bound AppShellWithPrefs pattern (AppShell.tsx).
//   The `{isAuthenticated && ...}` guard keeps Provider + Dialog
//   mount overhead at zero on the five anonymous paths
//   (/ /pricing /hotlist /about /login) — only when an
//   authed visitor lands on `/` does the Provider tree mount.

import { Link, useLocation } from '@tanstack/react-router'
import { useSearchParams } from '@/lib/router/useSearchParams'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { BrandMark } from '@/components/ui/brand-glyph'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UserMenu } from '@/components/UserMenu'
import { LocalePicker } from '@/components/LocalePicker'
import { useAuth } from '@/features/auth/useAuth'
import { useScrollPast } from '@/lib/use-scroll-past'
import { ROUTES } from '@/routes'
import {
  PreferencesDialog,
  PreferencesDialogProvider,
} from '@/features/preferences'

const NAV_ITEMS = [
  // Every item declares `isCta` (boolean), so TypeScript's narrowing
  // across the `as const` tuple treats all 5 items as the SAME shape
  // and `item.isCta !== true` / `item.isCta === true` accessors
  // resolve cleanly below. The previous per-item "conditional
  // `isCta: true` only on the last item" version surfaced as
  // TS2339 ("Property 'isCta' does not exist on type …") on the
  // `STATIC_ITEMS = NAV_ITEMS.filter(item => item.isCta !== true)`
  // line and on `CTA_ITEM = NAV_ITEMS.find(item => item.isCta === true)`.
  // Adding `isCta: false` to non-CTA rows preserves the original
  // per-item flag meaning without losing narrowing.
  //
  // `labelKey` is the i18n lookup key resolved at render time via
  // `t(item.labelKey)`; `labelFallback` is the Chinese default
  // surfaced if a missing-key regression ever ships (per ADR
  // docs/dev/adr-i18n-invariant.md §"fallback" — the empty-string
  // return is OFF, so missing keys fall through to the defaultLng).
  // `labelKey` is intentionally `as const` so the i18next typed
  // `t(...)` narrows against `keyof zhCN` rather than `string`.
  { labelKey: 'marketing.topbar.nav.home', labelFallback: '首页', to: '/', isCta: false },
  { labelKey: 'marketing.topbar.nav.pricing', labelFallback: '定价', to: '/pricing', isCta: false },
  { labelKey: 'marketing.topbar.nav.hotlist', labelFallback: '热榜', to: '/hotlist', isCta: false },
  { labelKey: 'marketing.topbar.nav.about', labelFallback: '关于', to: '/about', isCta: false },
  // `isCta: true` flips the render path from a muted text link to a primary
  // `<Button asChild variant="default">`. Position-based (#5) is sufficient
  // today since the user-picked order always puts the conversion at the end.
  // If a follow-up swaps 定价 and 登录, this harness still works because
  // the flag is per-item, not positional.
  //
  // Static `to: '/login'` here is a logical route identifier only — at
  // render time we override the destination to the computed `loginAuthHref`
  // (which prepends any inbound `?plan=` / `?intent=` query and points at
  // `/login/auth`). This mirrors the `authHref` pattern in
  // Pages/LoginPage.tsx — duplicated here so this file stays self-contained.
  { labelKey: 'marketing.topbar.nav.login', labelFallback: '登录', to: '/login', isCta: true },
] as const

// Round-OPT-chrome-responsive — split NAV_ITEMS into two rendering
// halves so layout-math budget gets broken efficiently:
//   • STATIC_ITEMS (4 items) — renders twice: once as inline text
//     links inside `<div className="hidden md:flex">` (desktop),
//     once as Radix DropdownMenuItem children inside the mobile
//     wrapper `<div className="md:hidden">`. CTA UNAFFECTED.
//   • CTA_ITEM (1 item) — renders once: as a primary
//     `<Button asChild variant="default">` regardless of viewport
//     (it's the conversion affordance — same hierarchy at every
//     breakpoint).
//
// Single source-of-truth for the 4 nav labels lives in NAV_ITEMS;
// STATIC_ITEMS derives the static half via a filter so reorder +
// relabel happens in ONE place. The CTA_ITEM lookup is O(1) and
// statically typed because the source array has `as const`.
const STATIC_ITEMS = NAV_ITEMS.filter((item) => item.isCta !== true)
const CTA_ITEM = NAV_ITEMS.find((item) => item.isCta === true)!

export default function MarketingTopBar() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const past = useScrollPast(80)
  // i18n — `t(item.labelKey, labelFallback)` resolves to the
  // current locale's chrome label, falling back to the Chinese
  // hard-coded baseline if the JSON resource misses a key. The
  // `useTranslation` hook also implicitly subscribes to locale
  // flips so re-renders fire when the user clicks <LocalePicker />.
  const { t } = useTranslation()
  // Authed-state chrome: when the visitor is signed in, the 登录 CTA
  // is replaced by the same UserMenu used in AppShell (sidebar footer
  // + mobile AppBar). The CTA in NAV_ITEMS is filtered out at map time
  // when `isAuthenticated` is true so the count drops from 5 → 4
  // (4 informational links) and the UserMenu occupies the same slot.
  const { isAuthenticated } = useAuth()

  // The TopBar `登录` button sends the visitor DIRECTLY to the
  // verification code form (`/login/auth`), bypassing the marketing
  // pitch at `/login` so the bright primary CTA matches visitor
  // expectation. Any inbound `?plan=` / `?intent=` / `?reason=...`
  // search params are preserved across the bounce — same forwarding
  // shape as `authHref` in Pages/LoginPage.tsx (`/login/auth${?...?`?${searchParams.toString()}` : ''}`).
  // Promoted to lib/useLoginAuthHref.ts if a third caller needs it.
  const loginAuthHref = `/login/auth${searchParams.toString() ? `?${searchParams.toString()}` : ''}`

  // Active-state logic — the CTA's active-span is the WHOLE
  // conversion flow (/login + /login/...), NOT just the
  // rendered `to` (loginAuthHref, which always points at
  // /login/auth/{search}). Without this branch, `aria-current=
  // "page"` only fires on /login/auth (where MarketingTopBar
  // is NOT rendered per the comment header) and never on
  // /login (where it IS rendered) — leaving the CTA visually
  // indistinguishable from other pages' identical-look button
  // round-OPT-ftr-V9-vision-fix.
  const ctaActive =
    location.pathname === '/login' ||
    location.pathname.startsWith('/login/')

  return (
    <header
      className={`sticky top-0 z-50 flex h-14 items-center justify-between bg-background/85 px-6 backdrop-blur-xl transition-colors duration-200 ${
        past ? 'border-b border-primary' : 'border-b border-border/40'
      }`}
    >
      {/* Brand lockup — always links to landing. Round-OPT-chrome-
          responsive: the BrandMark's `<span>` carries
          `hidden sm:inline` so visitors at <sm (640 px) see the
          BrandMark icon alone while ≥sm visitors see the full
          "social-auto-upload" wordmark. The `hidden` utility
          turns to `display: none` below 640 px; CSS-side
          resolution, no JS-side hooks.

          Round-OPT-ios-hig-tap-target: at <sm viewport the
          BrandMark ITSELF bumps from `size="sm"` (28×28) to
          `size="md"` (36×36) for iOS HIG 44×44 tap-target
          proximity on 320-414 px mobile devices. The sm:-
          prefixed overrides on the BrandMark's `className`
          prop flip the box back to 28×28 desktop density at
          ≥sm viewport — see the BrandMark call site for the
          exact override stack. */}
      <Link to={ROUTES.public.landing} className="flex items-center gap-2.5">
        {/* Round-OPT-ios-hig-tap-target — responsive brand mark:
            at <sm viewport (320-414 px mobile) bump from
            28×28 (`size="sm"`) to 36×36 (`size="md"`) for iOS HIG
            44×44 tap-target proximity (+8 px per axis vs the
            prior-round 28×28 mobile tap target). The
            `sm:h-7 sm:w-7 sm:text-[13px]` Tailwind responsive
            overrides flip the box back to the conventional
            28×28 desktop density at ≥sm viewport. CSS-only —
            @media (min-width: 640px) source-order wins, so
            no JS-side matchMedia hook needed. */}
        <BrandMark
          size="md"
          className="sm:h-7 sm:w-7 sm:text-[13px]"
        />
        <span className="hidden text-[14px] font-medium tracking-tight text-foreground sm:inline">
          social-auto-upload
        </span>
      </Link>

      {/* Nav cluster — text-[13px] + responsive 4-link split +
          CTA + UserMenu + theme. The static-link half (4 items)
          is rendered TWICE in different breakpoint contexts:
          desktop (inline text links) + mobile (DropdownMenu).
          Both wrappers carry the SAME breakpoint-class strings
          (`hidden md:flex` and `md:hidden`) so the responsive
          flip is CSS-side, not JS-state-driven — keeps the
          initial-paint HTML identical to the post-hydration
          HTML (no SSR mismatch surface). */}
      <nav
        aria-label={t('marketing.topbar.nav_label', '营销导航')}
        className="flex items-center gap-5 text-[13px] font-medium"
      >
        {/* Desktop-only inline 4-link cluster (≥md = 768 px). The
            wrapper carries `hidden md:flex` so <md visitors see
            the mobile menu trigger below instead. Each item is
            a `<Link>` mirroring the ORIGINAL MarketingTopBar
            NAV_ITEMS.map static-path rendering (text link,
            `aria-current="page"` for active, `text-foreground`
            vs `text-muted-foreground`). */}
        <div className="hidden items-center gap-5 md:flex">
          {STATIC_ITEMS.map((item) => {
            const active = location.pathname === item.to
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}                  className={`transition-colors hover:text-foreground ${
                    active ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {t(item.labelKey, item.labelFallback)}
                </Link>
              )
            })}
          </div>

        {/* Mobile-only DropdownMenu trigger (<md = 768 px). The
            wrapper carries `md:hidden` so ≥md visitors never see
            the trigger button. Menu icon (h-4 w-4) inside a Radix
            DropdownMenu / Button asChild / size="icon" pattern —
            resolves to h-8 w-8 px-0 button at browser runtime.
            `aria-label="导航菜单"` provides a screen-reader
            anchor for the otherwise-icon-only trigger. */}
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('marketing.topbar.mobile_menu_label', '导航菜单')}
                className="h-8 w-8 px-0"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4}>
              {STATIC_ITEMS.map((item) => {
                const active = location.pathname === item.to
                return (
                  <DropdownMenuItem key={item.to} asChild>
                    <Link
                      to={item.to}
                      aria-current={active ? 'page' : undefined}
                    >
                      {t(item.labelKey, item.labelFallback)}
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* CTA — always rendered (except when authed → UserMenu
            takes this visual slot). Cannot move into a
            breakpoint-aware wrapper because the conversion
            affordance must keep identical visual hierarchy at
            every viewport — the bright primary Button is what
            distinguishes "navigate" from "convert" and that
            hierarchy is the whole point of the chrome. */}
        {!isAuthenticated && (
          <Button
            asChild
            variant="default"
            // Active-state visual — when `aria-current="page"`
            // propagates via Radix Slot to the inner <a>, the
            // variant-selector classes `aria-[current=page]:shadow-
            // md aria-[current=page]:shadow-primary/40` upgrade the
            // default `shadow-sm shadow-primary/20` to a stronger
            // shadow. Rationale: (a) box-shadow → ZERO layout
            // shift, (b) no conflict with the existing
            // `focus-visible:ring-1 ring-ring` cva ring, (c) light
            // + dark mode universal (primary tint is the same in
            // both), (d) the variant selector piggy-backs on the
            // existing aria-current attribute emitted below — no
            // new state plumbing needed.
            className="h-8 px-4 text-[13px] font-medium shadow-sm shadow-primary/20 aria-[current=page]:shadow-md aria-[current=page]:shadow-primary/40"
          >
            <Link
              to={loginAuthHref}
              aria-current={ctaActive ? 'page' : undefined}
            >
              {t(CTA_ITEM.labelKey, CTA_ITEM.labelFallback)}
            </Link>
          </Button>
        )}

        {/* Round-OPT-prefs-dialog-v7 (chrome composition):
            mirror AppShellWithPrefs' AppShell-bound pattern — wrap
            the authed-branch <UserMenu /> in
            <PreferencesDialogProvider> + <PreferencesDialog /> so
            anonymous visitors see no Provider overhead AND
            authenticated visitors land in the same dialog UI as
            the AppShell sidebar footer / mobile AppBar.
            UserMenu's 4 dropdown items call `openPreferences(tab)`
            which must be in scope — without this wrap the public
            landing / throws "usePreferencesDialog must be used
            within a PreferencesDialogProvider". The Dialog mounts
            CLOSED by default (`open=false`) so consumes zero pixels
            until UserMenu fires the first preference click. */}
        {isAuthenticated && (
          <PreferencesDialogProvider>
            <UserMenu mode="mobile" />
            <PreferencesDialog />
          </PreferencesDialogProvider>
        )}

        {/* LocalePicker — visitor-facing chrome control, sibling of
            <ThemeToggle size="compact" />. Both controls grouped at
            the end of the nav cluster so the inline-link half (4
            items + CTA) keeps visual primacy. See <LocalePicker />
            for the 3 commitments (native-language labels,
            compact envelope, active checkmark).
            <ThemeToggle /> sits to the LEFT of <LocalePicker /> —
            theme is more frequently toggled than locale, so the
            more-frequent affordance sits closer to where the eye
            lands after scanning the nav links. */}
        <ThemeToggle size="compact" />
        <LocalePicker />
      </nav>
    </header>
  )
}
