---
version: post-reset-3 + post-pr-opt-final
name: sau-design-system
status: system-level reference

description: |
  Engineering-tool aesthetic for the sau-web frontend (sau@main web shell).
  Cold-neutral canvas with a single sodium-amber accent, IBM Plex Sans for
  display + body, IBM Plex Mono for code / IDs / timestamps / brand glyph.
  Two surfaces in the unified `:5180` Vite app: visitor-facing product
  landing at `/` (`LandingPage.tsx`, paying-customer copy only)
  + operator-facing dashboard at `/dashboard/*` (engineering-tool aesthetic).
  Per-component recipes live in DESIGN-components.md.

scope: |
  This file is the SYSTEM reference: tokens, palette, typography, radius,
  the 4-band status semantic contract, chrome patterns, boundaries,
  migration history, iteration guide, and known open lint baseline.
  Looking for HOW to use `<Button>` or `<Dialog>`?
    • Reading text-only / offline: `DESIGN-components.md`.
    • Want live rendered demos: `DESIGN-components.mdx` (mounted by
      `CatalogPage.tsx` at `/catalog` during `pnpm dev`).
  Looking for WHY the system looks the way it does? You're in the right place.

canvas:
  light:
    background: "oklch(0.985 0.002 240)"   # near-white, faint cool tint
    foreground: "oklch(0.18 0.003 240)"    # near-black ink
    card:       "oklch(0.965 0.002 240)"
    border:     "oklch(0.86 0.005 240)"
    muted:      "oklch(0.93 0.005 240)"
  dark:
    background: "oklch(0.16 0.003 240)"    # deepest surface
    foreground: "oklch(0.94 0.003 240)"    # light ink
    card:       "oklch(0.20 0.003 240)"
    border:     "oklch(0.32 0.005 240)"
    muted:      "oklch(0.24 0.003 240)"

accent:
  name: sodium-amber
  rationale: |
    Industrial control-panel aesthetic — aircraft / railway signaling. Single
    chromatic accent total, used scarcely on brand mark, sidebar active strip,
    primary CTA, focus ring, link emphasis. Anything amber-adjacent must be
    the SAME sodium-amber token; never a second hue family.
  light: "oklch(0.62 0.14 90)"             # medium amber
  dark:  "oklch(0.78 0.14 90)"             # lighter amber on warm dark

semantic-status:
  # 4-band contract, consumer is src/lib/tone.ts::rateToTone.
  # Do NOT introduce a 5th status. Status palette is reserved for semantic
  # meaning; the single amber accent is reserved for chrome emphasis.
  success:  { light-fg: "oklch(0.42 0.14 145)", dark-fg: "oklch(0.74 0.16 145)" }
  warning:  { light-fg: "oklch(0.48 0.14 90)",  dark-fg: "oklch(0.78 0.14 90)" } # shares hue family with primary, lower chroma
  info:     { light-fg: "oklch(0.42 0.10 200)", dark-fg: "oklch(0.72 0.10 200)" } # steel-cyan, distinct from amber
  error:    { light-fg: "oklch(0.50 0.18 25)",  dark-fg: "oklch(0.72 0.18 25)" }

typography:
  display:
    family: "'IBM Plex Sans', ui-sans-serif, system-ui"
    weight: 600                              # Plex sans 600 reads at Outfit 700 impact
    tracking: "-0.01em"
  body:
    family: "'IBM Plex Sans', ui-sans-serif, system-ui"
    weight: 400
    tracking: "0"
  mono:
    family: "'IBM Plex Mono', ui-monospace, SFMono-Regular"
    weight: 400
    use: "code, log timestamps, terminal panels, brand mark glyph, breadcrumb strip, task / account IDs, build SHAs, KBD hints"

radius:
  base: "0.375rem"                           # tightened from prior 0.5rem (round 3)
  scale:
    sm: "calc(var(--radius) - 4px)"          # → 2px
    md: "calc(var(--radius) - 2px)"          # → 4px
    lg: "var(--radius)"                      # → 6px
    xl: "calc(var(--radius) + 4px)"          # → 10px
  philosophy: |
    Hairline-leaning. Brand mark glyph block uses `rounded-[3px]` (explicit,
    not from token). Buttons / form inputs use `rounded-md`. Cards use
    `rounded-xl`. Sidebar / bottom nav uses `rounded-lg`. Modals / dialogs
    use `rounded-lg` on desktop and full-bleed zero-radius on mobile
    (`sm:rounded-lg` in shadcn Tailwind bindings).
    Loose `rounded-full` is reserved for true semantic pills (StatusBadge).
    NEVER `rounded-full` a CTA.

monorepo-wordmark: "sau@main"
pillow-text-rules:
  separator-glyph: "·"            # U+00B7 HAIRLINE MIDDLE DOT
  # Use `·` (U+00B7) as the separator in any mono metadata strip
  # (breadcrumbs, status lines, mono nav lists, KBD hints). The
  # following glyphs are forbidden because IBM Plex Mono renders the
  # middle dot at hairline weight against `tabular-nums` and renders
  # the rest heavy enough to read as visual noise:
  separator-forbidden:
    - "•  (U+2022 BULLET)"          # never use as separator
    - "-  (U+002D HYPHEN)"          # never use as separator
    - "–  (U+2013 EN DASH)"         # never use as separator
    - "—  (U+2014 EM DASH)"         # never use as separator
    - "|  (U+007C PIPE)"            # never use as separator
  rationale: |
    The U+00B7 hairline middle dot renders at hairline weight inside
    IBM Plex Mono + `tabular-nums`. Every prohibited glyph renders
    heavier and reads as decorative noise against the engineering-tool
    aesthetic. Use `·` literally (codepoint U+00B7) in any mono
    metadata strip.

chrome-patterns:
  # Patterns that are SYSTEM-level (recurring across multiple surfaces).
  # Per-component-patterns (e.g., sidebar row state, dialog overlay)
  # live in DESIGN-components.md.
  sidebar-active-row:
    treatment: |
      2px hairline left-edge accent strip in `--primary` (sodium amber),
      NO block-fill. Active state is signaled by full-ink `text-foreground`
      AND the leading-edge strip, NOT by `bg-foreground/[0.08]`.
    text:      "foreground ink (full chroma)"
    non-active-hover: "hover:bg-foreground/[0.04] (subtle hover-only tint)"
  mono-top-breadcrumb:
    treatment: "font-mono text-[11px] tabular-nums, `·` separators, status dot"
    payload:   "sau@main · build a7f3b21 · [●] ws ok · mainline"
    placement: "left edge of dashboard header"
    rule:      "Set `aria-hidden` on the leading ` [`●]` dot; the dot is decorative."
  motion-grammar:
    visitor-only: "scoped to LandingPage + PricingPage; not propagated to operator dashboard yet."
    duration: "550ms reveal · 180ms hover · 70ms inter-cell stagger"
    ease: "power2.out (engineering-tool precision; no spring physics, no overshoot)"
    reveal-cells:
      hero: "[data-hero-cell] — fade-in immediately on mount, no scroll trigger, 80ms stagger"
      grouped: "[data-reveal-cell] nested inside a [data-reveal-group] — share one ScrollTrigger; top 88% start, once:true"
      standalone: "[data-reveal-cell] not in a group — own ScrollTrigger; top 92% start, once:true"
    topbar-elevation: |
      The visitor-surface TopBar bottom hairline flips from
      `border-border/40` (cold-neutral) to `border-primary/45`
      (sodium amber at 45%) once `window.scrollY > 80px`.
      `transition-colors duration-200` makes the swap ease.
      `useScrollPast()` (rAF-throttled, `src/lib/use-scroll-past.ts`)
      is the source of truth.
    brand-cursor: |
      The trailing `_` token of the `>_` glyph blinks at 1.1s
      `steps(2, end)` cadence via the `.brand-cursor` utility.
      Reserved ONLY for the brand mark, never arbitrary text. Canon-
      ical terminal-prompt metadata — distinct from the deleted
      `.status-running::after halo` (round 1). Reduced-motion: cursor
      stays lit static.
    recommended-tier-accent: |
      PricingPage `<TierCardBlock>` when `tier.highlight` is true
      receives the `.tier-recommended-accent` class — `box-shadow:
      inset 0 -1px 0 0 color-mix(in oklab, var(--primary) 45%, transparent)`.
      One-pixel amber hairline at the bottom INSIDE the border, not
      a glow, not a full perimeter. Pairs with the existing
      `border-foreground/45` ring for an engineering-tool honest
      recommendation signal without decorative shine.

wordmark-surfaces:
  sidebar-brand:  "in fg-filled square with `>_` terminal-prompt glyph above 'sau@main' / 'build a7f3b21' mono labels"
  mobile-header:  "in fg-filled square + 'sau@main' mono glyph-companion"
  login-card:     "in fg-filled square (rounded-[3px]) above 'sau@main' h1 in mono + 'build a7f3b21 · mainline' mono caption"
  doc-title:      "<title>sau@main</title>  (favicon / browser tab)"
  rule: |
    The terminal-prompt `>_` glyph is the ONLY brand mark. Never substitute
    a lightning bolt, sparkles, "S", or any consumer icon.

boundaries:
  marketing-surface: |
    REINSTATED at `/` as a paying-customer product landing
    (`src/Pages/LandingPage.tsx`), inside the same unified frontend Vite
    app on `:5180`. The unified app now hosts TWO surfaces:
      • Visitor-facing product landing at `/` (LandingPage).
      • Visitor-facing pricing surface at `/pricing` (PricingPage) — paid-
        conversion funnel, public, parallel to `/`. No AuthGuard so anonymous
        visitors can compare tiers before sign-in.
      • Operator-facing dashboard at `/dashboard/*` (AccountGroupsPage / Publish /
        Logs / Tasks / AI panel). No public `/marketing` subtree — the product
        landing IS the unified app's index. The `/login` route also belongs
        to the visitor surface (no AuthGuard).
    Customer-facing copy on `/` MUST speak PRODUCT to paying customers
    (MCN / multi-account operators / content creators), NOT technology.
    The following read as developer-coded on the landing surface and are
    banned from `LandingPage.tsx` and readme/CLAUDE.md "what is this"
    sections:
      • `CLI` / `Agent Skill` / `patchright` / `playwright` / `uv pip` /
        `bash sau_web/start.sh` / install command snippets.
      • GitHub stars / `open source` / `MIT License` / `9k+ ⭐` ONLY when
        wrapped in tech-coded adjacency on the landing surface — e.g.
        `9k+ ⭐ on GitHub` paired with `sau@main · build public` mono
        strips, `open source · MIT` rendered in mono top-breadcrumb
        format, or GitHub iconography treated as devtool parallax.
        GitHub exit link / `open source` mention / star count AS
        customer-credibility social proof (sans-typography, framed as
        product value) is FINE — it's the FORMATTING that reads dev,
        not the underlying fact that the project is open-source stars.
      • The internal surface name `Web Shell` in mid-Chinese customer copy;
        use the customer-friendly terms "控制台" / "运营台" / "工作台".
      • Mono tech strips like `sau@main · build public` / `build a7f3b21`
        / `持续维护中` attached to the visitor brand lockup.
      • Hero / promo stats whose number claims a specific time / cost saving
        without ATTRIBUTION. Every visitor-facing stat needs an attribution
        (e.g. `3h+/day · 典型多账号` / `6 · 主流平台已接入` / `不上云 · 数据
        归属您`), a sourceable mechanism (counted-from-codebase platforms),
        or a product-positioning claim. A bare number reading as a personal
        outcome ("每天节省 3 小时" with no subject) reads as marketing fluff
        and conflicts with the cold-neutral engineering-tool aesthetic.
    The aesthetic — cold-neutral canvas, single sodium-amber accent,
    hairline borders, no glass / gradient / pulse, IBM Plex Sans+ only —
    is preserved. Mono remains reserved for IDs / build SHAs / terminal
    glyphs / status dots; wordmark and body copy live in sans.
  m3u8-deep-fetch: |
    Post-Round-19 Path C decision (sibling of `marketing-surface:` above
    — these two are the project's positive "what is allowed" boundaries;
    the rest of `boundaries:` are deletions that must not return).
    `_try_patchright` in `web_runner/routes/inbox.py` is DELIBERATELY
    a no-MSE / no-segment-fetch fallback: it does NOT take the
    `<video>.currentSrc` URL and run a multi-segment HLS download.
    Rationale: (a) cookie-transport — chromium context cookies do not
    carry into urllib's plain `urlopen`, so login-walled m3u8 streams
    403 segment-by-segment; (b) per-segment SSRF — every segment URL
    has to satisfy `_is_public_url` + `_resolve_is_public`, multiplying
    DNS-resolver roundtrips by ~1000 segments per 1h-720p stream;
    (c) HLS spec completeness — master-playlist, AES-128 encryption,
    init segments, and PTS alignment all require either a pip `m3u8`
    parser or a hand-rolled state machine, both exceeding pony-minimal
    scope; (d) ffmpeg-remux dependency for browser-playable `.mp4`
    output.
    `yt-dlp` (proc 1 in `_try_ytdlp`) owns m3u8 download via its 1500+
    extractor matrix + `--no-playlist` + format selectors. The
    user-visible 502 surface for a real m3u8 stream is
    `_MIN_VIDEO_BYTES = 64 * 1024` (Round 18 B2 fix) — manifests
    < 64KB and the `< 64KB` reason string is grep-friendly. If a
    future platform ever REQUIRES segment fetch via the fallback,
    the recommended path is `m3u8` Rust crate via pyo3 bindings
    — NOT a hand-rolled Python parser. Cross-ref:
    `web_runner/routes/inbox.py::_MIN_VIDEO_BYTES` Path-C inline
    anchor + `openspec/changes/project-optimization/tasks.md` §7.1
    v0.2 polish candidate memo.
  ssrf-gate: |
    Post-Round-29 (Round-29 v4 mirror) positive-decision boundary
    (third sibling of `marketing-surface:` and `m3u8-deep-fetch:`
    — the project's "what is allowed" boundaries). The inbox route's
    SSRF defense has TWO gates (Round-19 sec-1) and a single shared
    carve-out for `198.18.0.0/15` (Round-29 → Round-29 v4):

      • `_is_public_url` (literal-IP string check) — single IP, early-
        return `True` on `198.18/15` match.
      • `_resolve_is_public` (DNS-resolve + per-record check) — loop
        over all A/AAAA records, `continue` per-record on `198.18/15`
        match (NOT `return True`, which would short-circuit later
        private records).

    Why the carve-out exists: Python's `ipaddress.is_private()` over-
    classifies the entire RFC 2544 §4 benchmark-testing allocation
    (`198.18.0.0/15`) as private. That allocation IS public-routable
    per IANA — used for network interconnect benchmarking, sandbox
    DNS sinkholes, NAT gateway pools. Without the explicit exemption,
    every public URL routed via this range false-positives the gate.
    `v.douyin.com` resolving to `198.18.0.103` was the original
    reproducer.

    The asymmetric shape (early-return vs. `continue`) reflects the
    asymmetric inputs of the two gates. Locked by 6 tests in
    `tests/test_inbox.py`:

      • `test_is_public_url_exempts_198_18_15` — literal `/15` bounds.
      • `test_is_public_url_carve_out_does_not_broaden_to_other_private_ranges`
        — loopback / RFC1918 / metadata / unspecified / reserved
        still reject.
      • `test_is_public_url_still_rejects_non_http_schemes` — scheme
        validation unaffected by carve-out.
      • `test_is_public_url_still_rejects_localhost_name` — names
        (not IPs) unchanged.
      • `test_resolve_is_public_exempts_198_18_15` — DNS-resolve
        `/15` bounds + adjacent non-carve-out `198.20.0.1` accept.
      • `test_resolve_is_public_carve_out_does_not_mask_private_in_mixed_records`
        — mixed records `[198.18.0.5, 127.0.0.1]` still REJECT,
        proving per-record `continue` (NOT a blanket `return True`
        shortcut). Without this test, a future reviewer could swap
        `continue` for `return True` and the suite would silently pass.

    Cross-ref: `web_runner/routes/inbox.py::_resolve_is_public`
    (carve-out + Anchor note) and `web_runner/routes/inbox.py::
    _is_public_url` (carve-out + Anchor note) — both contain inline
    Path C-style rationale comments referencing this YAML anchor.
  fonts: "IBM Plex Sans + IBM Plex Mono only — Outfit / DM Sans / JetBrains Mono / Newsreader all removed."
  glass-morphism: "deleted (rounds 1 + 3)"
  gradient-text: "deleted and the rule itself scrubbed from index.css"
  pulse-animations: ".status-running::after halo deleted; 'subtle-pulse' keyframe deleted"
  info-bg: "info semantic hue shifted from lavender (Linear impersonation) to steel-cyan (hue 200)."

do:
  - "Reserve `--primary` (sodium amber) for: brand mark, active sidebar strip, primary CTA, focus ring, link emphasis."
  - "Hairline borders everywhere (1px solid var(--border)); never drop-shadow on flat surfaces."
  - "Mono only for IDs / counts / timestamps / build SHAs / status dots / terminal glyphs / KBD hints."
  - "Sans (Plex Sans 400) for body Chinese / English paragraphs — DO NOT switch body to mono (CJK paragraphs in mono are unreadable)."
  - "Terminal-prompt `>_` glyph is the only brand mark."
  - "Active sidebar row uses 2px hairline amber strip + full-ink text; no `bg-foreground/[0.08]` block fill."
  - "Use `·` (U+00B7 hairline middle dot) as separator in any mono metadata strip."

dont:
  - "Don't ship a warm-editorial palette, glass / gradient / pulse, or a second chromatic accent on the landing surface. The reinstated `/` `LandingPage` is a product subtree, not a marketing-subtree-with-cream-warm-brown-Newsreader; preserve the engineering-tool aesthetic (cold-neutral canvas + single sodium-amber accent + hairline borders + IBM Plex Sans/Mono only)."
  - "Don't introduce a second chromatic accent (no green / red primaries beyond semantic)."
  - "Don't add atmospheric gradients or spotlight cards."
  - "Don't pill-round CTAs (`rounded-md` 4px max for buttons; `rounded-full` reserved for StatusBadge)."
  - "Don't use Outfit, DM Sans, JetBrains Mono, or Newsreader (all removed)."
  - "Don't use lavender / purple / blue-rim glass anywhere."
  - "Don't put a floating log console in production chrome (deleted; `/logs` page exists)."
  - "Don't introduce a 5th status semantic. The 4-band contract is the consumer's contract (src/lib/tone.ts::rateToTone)."

migrated-from:
  round_1_industrial-reset: "killed Linear Lavender (#5e6ad2 → sodium amber hue 90). Font stack: Outfit+DM Sans+JetBrains Mono → IBM Plex Sans+Mono. FloatingLogs deleted. .gradient-text / .glass / pulse animations scrubbed."
  round_2_warm-landing: "added .landing-theme scope with cream/warm-brown/ink-green triad + Newsreader serif for marketing subtree."
  round_3_hide-marketing: "DELETED marketing subtree entirely. .landing-theme scope scrubbed. Newsreader removed. Root `/` → `/app` redirect. Brand glyph swapped to terminal `>_`. Mono top breadcrumb added. --radius tightened to 0.375rem. Active sidebar row Linear-strip pattern."
  round_4_reinstate-product-landing: |
    REINSTATED `/` as a paying-customer product landing
    (`src/Pages/LandingPage.tsx`) inside the unified frontend Vite app
    (port moved from `:5174` standalone to `:5180` merged-with-dashboard per
    the marketing-merge option A decision recorded in README.md /
    docs/web-shell.md / CLAUDE.md). Aesthetic constraints from rounds 1+3
    preserved (cold-neutral canvas, single sodium-amber accent, hairline
    borders, no glass / gradient / pulse). Copy reconceived as PRODUCT not
    TOOL: headline `一条视频 · 一键发布到 6 个平台`, subline frames the
    operator's daily pain (切换 6 个 App / 复制 6 次文案 / 盯 6 个发布状态),
    capability pills collapsed to `视频 / 图文 / 定时 / AI 文案` (dev-coded
    `CLI / Web / Skill / 自动化` removed), status labels migrated from
    `mainline / beta / wip` → `主线 / 支持中 / 筹备中` for customer
    comprehension, hero stat row rebuilt with `6 / 3h+ / 不上云` value props.
    The `Web Shell` URL target at `/dashboard/*` is preserved unchanged; only the
    Chinese customer-facing label is friendlier (`控制台` not `Web Shell`).
    DESIGN.md `boundaries.marketing-surface` updated to the two-surface
    topology (visitor landing at "/" + operator dashboard at "/dashboard/*"); a
    banned list of dev-coded vocabulary on the landing surface is enforced
    alongside. Operator-facing documentation (CLI usage / install / Agent
    Skill install) lives in the operator dashboard help / README `/ CLI.md`
    and is excluded from the landing surface by policy.
  round_5_add-pricing-surface: |
    ADDED `/pricing` (`src/Pages/PricingPage.tsx`) as the third visitor
    surface — paying-customer conversion funnel, public route parallel to
    `/` and `/login`. 3 SaaS-style tier cards (个人 ¥0 / 团队 ¥199/月 [推荐] /
    企业 联系销售) with productivity-focused caps (账号数 / 发布额度 / AI
    文案 / 多人协作 / 私有化部署). The middle tier is visually differentiated
    via a subtle `border-foreground/30` ring (engineering-tool aesthetic, no
    glass / gradient / cyan halo). Pricing CTAs all flow to `/login?plan=…
    ` (public route, no auth wall) so anonymous visitors can compare tiers
    AND choose a plan without first signing in. Visitor-surface Chrome
    (TopBar + PageFooter) is mirrored from LandingPage and parametrised with
    `useLocation()` so the active nav link is rendered with full ink.
    `boundaries.marketing-surface` block extended to enumerate 3 visitor
    routes (`/`, `/pricing`, `/login`) — the prior enumeration only listed
    2 and would have drifted once the PricingPage route landed. App.test.tsx
    gained 2 routing assertions (`/pricing` anonymous + authenticated both
    render PricingPage directly, no AuthGuard bounce).
  post_round_3_split_docs: "DESIGN.md scoped to system-level. DESIGN-components.md introduced for per-component recipes. dialog content radius drift fixed (sm:rounded-lg 6px not 10px)."
  round_6_hedge-hero-stat: |
    Hedged the `LandingPage.tsx` Hero stat row to satisfy paying-customer
    calibration. Middle stat moved from bare `3h+ / 每天省下的运营时间`
    (unsubstantiated personal-outcome claim) to `3h+/day / 典型多账号 · 每
    天省下` (number carries `/day` rate framing + `典型多账号` operator
    qualifier + `· 每天省下` caption tying the number to the qualifier).
    The `·` separator in the new caption matches the same-surface
    precedent already on the right-side stat (`数据归属您 · 私有部署`),
    so the three stat cells read as one rhythmic row on first glance.
    PricingPage's parens-with-caveat shape (`提供 14 天试用 (以商务确认为准)`)
    addresses a *different* concern (disclaiming a future service promise)
    and is intentionally NOT mirrored here — cross-surface hedge shapes
    are kept distinct because their semantic role (attribution vs.
    disclaimer) is distinct. `boundaries.marketing-surface`
    block gained a banned-stat bullet: any visitor-facing stat whose
    number lacks an attribution / sourceable mechanism / product-position
    claim is rejected on the cold-neutral canvas — bare outcome numbers
    read as marketing fluff and conflict with the engineering-tool
    aesthetic.    Inline comment added above `HeroSection` so a future contributor adding a 4th stat slot inherits the convention from
    the file rather than re-deriving it.
  round_7_stat-tokens-migration: |
    Codified the visitor-surface stat rhythm into a primitive + token set.
    Extracted the inline `<Stat>` rhythm into `src/Components/ui/stat.tsx`
    — a primitive that enforces subject · predicate attribution at the type
    level (caption is REQUIRED, no `?`). Three token families added to
    `src/index.css` `:root` + `@theme inline` aliases: `--stat-eyebrow-*`,
    `--stat-value-{sm,,xl}-*`, `--stat-caption-{sm,}`. Two size ladders
    supported: `sm` (24/30px for the Hero stat row) and `md` (30/36px for
    the Pricing rate block). Hero row left cell normalised: `6 / 主流平台
    已接入` → `6 / 主流平台 · 已接入` so all 3 cells share the subject ·
    predicate caption rhythm. PricingPage tier-card name eyebrow + price
    block now compose with the shared tokens (`text-stat-eyebrow
    tracking-stat-eyebrow` + `<Stat variant="inline" size="md">`). Inline
    file header on LandingPage HeroSection compressed from 12 to 4 lines;
    the convention is now codified in the component, not the file comment.
  round_8_motion-grammar-publish: |
    Locked the visitor-surface motion grammar into a coherent contract.
    Five primitives + tokens added:
      • `useRevealStagger()` (`src/lib/use-reveal-stagger.ts`): GSAP
        hook driving entrance choreography via three markers —
        `[data-hero-cell]` (mount fade-in, 80ms stagger), `[data-reveal-
        group]` (scroll-triggered top-88% start), `[data-reveal-cell]`
        standalone fallback. Reduced-motion respected via
        `gsap.matchMedia`. Token contract: 550ms duration · 70ms
        stagger · 14px translateY · `power2.out` ease.
      • `useScrollPast()` (`src/lib/use-scroll-past.ts`): rAF-throttled
        scroll listener that flips a boolean once `window.scrollY >
        80px`. Powers the TopBar hairline swap.
      • `.brand-cursor` utility (index.css): trailing `_` glyph of
        `>_` blinks at 1.1s `steps(2, end)`. Canonical terminal-prompt
        cadence — distinct from the deleted `.status-running::after
        halo`. Reduced-motion: cursor stays lit static.
      • `.tier-recommended-accent` utility: 1px inset amber hairline
        at the bottom of the recommended pricing tier card.
      • `--motion-{duration-reveal, stagger-reveal, translate-y}`
        tokens: single source of truth for any future motion-driven
        keyframe.
    Visitor surfaces reused: LandingPage Hero stat row (3 cells,
    mount entrance), LandingPage Platforms grid (6 cards, scroll
    stagger), LandingPage Features grid (4 cards, scroll stagger),
    PricingPage Hero (1 fade-in), PricingPage Tiers grid (3 cards,
    scroll stagger + recommended-tier amber hairline), PricingPage
    CommonFeatures grid (5 bullets, scroll stagger). Both TopBars
    adopt the scroll-aware border-b swap.
    Constraints honoured: no glass, no pulse, no atmospheric
    gradient. Every entrance uses `transform: translateY + autoAlpha`
    (transform-only, GPU-friendly). Spring physics avoided (would read
    as decorative); `power2.out` keeps the engineering-tool precision
    feel.

---

## Overview

This document captures the **current** design system for `sau-web/frontend/` as a tooling product with a paying-customer landing surface. Rounds 1–4 have scrubbed the prior Linear-marketing aesthetic from both code and tokens; if you find yourself reaching for `bg-primary/[0.15] blur-3xl` or a glass morphology panel, you're reading an older guideline. The warm-editorial palette / gradient / glass morphology are gone; the `>` console-prompt brand glyph, hairline borders, single sodium-amber accent, cold-neutral canvas, and IBM Plex Sans/Mono-only type system are what the codebase reads as today across both the visitor landing surface ( `/` ) and the operator dashboard ( `/dashboard/*` ).

The system reads as **dev-tool documentation**: dense, mono-influenced, hairline-correct, single accent. The sidebar in particular is the canonical example — `>_` glyph, mono labels, 2px amber active strip with no block fill. The dashboard header carries a mono breadcrumb (`sau@main · build a7f3b21 · [●] ws ok · mainline`) that mirrors a Linear issue-pane / vscode-status-bar pattern.

**Single chromatic accent.** Sodium amber (`--primary`, hue 90) carries brand mark, focus ring, sidebar active strip, primary CTA, link emphasis, breadcrumb status dot. Nothing else uses amber hue (warning semantic shares hue family at lower chroma, never decorative). Status palette is forest-green / amber-shared / steel-cyan / red, each tied to a semantic role consumed by `src/lib/tone.ts::rateToTone`.

**No second accent. No gradients. No glass. No pulse.** Every animation is a state transition — fade-up for content entrance, accordion-down/up for disclosure, spinner for indeterminate loading. No decorative `subtle-pulse`, no `gradient-text` flow, no `bg-orb / blur-3xl` wash.

**Where to look.** This file covers **system-level** rules. Per-component recipes (Button / Card / Input / Popover / Dialog / SidebarRow / StatusBadge / ProgressBar / Toast) live in two siblings:

- **`DESIGN-components.md`** (repo root) — text-only spec, offline-readable. The prose recipe, do/don't, and a11y notes for each component.
- **`DESIGN-components.mdx`** (path: `sau_web/frontend/content/DESIGN-components.mdx`) — renderable version with `<Demo>` blocks for each of the 9 components. Lives inside the vite project tree so the MDX pipeline can resolve `react/jsx-runtime` and `@mdx-js/react` through project-root `node_modules`. Mounted by `CatalogPage.tsx` at `/catalog` during `pnpm dev`. Visual contract is identical to what feature authors will produce.

> Resync rule: when refining the recipe, do/don't, or a11y notes in either file, mirror the change in the other. The two siblings are load-bearing duplicates — `DESIGN-components.mdx` is the live renderable form, `DESIGN-components.md` is the offline-readable form; the content is meant to stay in lockstep.

If you're authoring a feature, start with `.mdx` for the visual contract, drop back to `.md` for the recipe + do/don't details, and to **this file** only when you need WHY a rule exists or how to add a new token.

## Canvas

The canvas is **cold-neutral near-black** in dark mode (`oklch(0.16 0.003 240)`) and **near-white with a 0.002 chroma blue tint** in light mode (`oklch(0.985 0.002 240)`). The cool tint keeps both canvases from drifting toward a hand-picked colour that would suggest "branded lifestyle" instead of "operating system".

**Surface ladder (light):**

| Level | Token | OKLCH | Used by |
|---|---|---|---|
| canvas    | `--background` | `oklch(0.985 0.002 240)` | page background |
| card      | `--card`       | `oklch(0.965 0.002 240)` | cards, dialogs, popovers |
| muted     | `--muted`      | `oklch(0.93 0.005 240)`  | chips, secondary fills, table hover |
| border    | `--border`     | `oklch(0.86 0.005 240)`  | 1px hairline borders (no decorative use) |

**Surface ladder (dark):**

| Level | Token | OKLCH | Used by |
|---|---|---|---|
| canvas    | `--background` | `oklch(0.16 0.003 240)` | deepest |
| card      | `--card`       | `oklch(0.20 0.003 240)` | cards, dialogs |
| popover   | `--popover`    | `oklch(0.23 0.003 240)` | popovers, dropdowns |
| muted     | `--muted`      | `oklch(0.24 0.003 240)` | chips, secondary fills |
| border    | `--border`     | `oklch(0.32 0.005 240)` | 1px hairline borders |

Borders are **hairline** borders, not "decorative panels". Never use them as section backgrounds.

## Typography

### Font families

- **IBM Plex Sans** — display + body. Industrial grotesk tuned for UI density (Carbon family). One typeface covers both roles; vertical rhythm doesn't swing between display sans and DM Sans metrics mid-page.
- **IBM Plex Mono** — code, log timestamps, terminal panels, brand mark glyph, breadcrumb strip, task / account IDs, build SHAs, KBD hints. Never used for body Chinese / English paragraphs.
- No third family load. No `Outfit`, no `DM Sans`, no `JetBrains Mono`, no `Newsreader`. The Google Fonts URL in `index.html` reflects this exactly.

### Hierarchy

- Display uses **Plex Sans 600** with `-0.01em` letter-spacing. Plex sans 600 reads at the equivalent visual weight of Outfit 700 — going lighter on weight keeps display type sharp rather than heavy.
- Body uses **Plex Sans 400** at default tracking. CJK glyphs (Chinese paragraphs) require sans for legibility — switching body to mono would visibly distort Chinese character widths.
- Sections are titled with display weights. Eyebrows (deprecated; no longer used by any surface) used positive tracking.

### Mono usage (three places, ONLY these)

1. **Brand mark glyph** — the `>_` character on sidebar / mobile header / login card. `aria-hidden` so screen readers skip.
2. **Mono top breadcrumb** — `sau@main · build a7f3b21 · [●] ws ok · mainline`. `font-mono text-[11px] text-muted-foreground/80 tabular-nums`. The `·` is a hairline middle-dot.
3. **Code, log timestamps, KBD hints, IDs, SHA hashes** — wherever humans glance at a number to verify currency (account counts, build versions, polling intervals). Mono + `tabular-nums` keeps each digit the same width.

## Radius

`--radius: 0.375rem` (6px) is the base. Tailwind v4 cascade through `@theme`:

| Token | Value | Used by |
|---|---|---|
| `rounded-sm` | 2px | tight chips inside dense tables |
| `rounded-md` | 4px | buttons, form inputs |
| `rounded-lg` | 6px | sidebar rows, brand glyph block, dialog content (desktop) |
| `rounded-xl` | 10px | cards (shadcn `<Card>`) |
| `rounded-[3px]` | 3px (explicit, not from token) | sidebar brand mark, mobile brand mark, login card glyph block |
| `rounded-full` | n/a pill | Reserved for StatusBadge and other semantic pills only — NEVER a CTA |

**Dialog radius** (per `dialog.tsx`): desktop `sm:rounded-lg` (6px); mobile full-bleed zero-radius (no `<sm:`). This is a screen-size concern, not a token override.

## Status semantic palette (4-band contract)

Locked in `src/lib/tone.ts::rateToTone`. Every status pill, chip, dot must source from this palette. **Do not introduce a 5th status** — the consumer is the rate-to-tone mapping, and adding meaning past the 4 band breaks that mapping's contract.

| Semantic | Light fg | Dark fg | Use |
|---|---|---|---|
| success | `oklch(0.42 0.14 145)` | `oklch(0.74 0.16 145)` | Connected, healthy, account valid |
| warning | `oklch(0.48 0.14 90)`  | `oklch(0.78 0.14 90)`  | Polling, in-flight, "mostly healthy" (rate ∈ [0.79, 1)) |
| info    | `oklch(0.42 0.10 200)` | `oklch(0.72 0.10 200)` | Steel-cyan — distinct from primary amber. Reserved for "informational" without competing with the single accent. |
| error   | `oklch(0.50 0.18 25)`  | `oklch(0.72 0.18 25)`  | Failed task, invalid cookie, broken connection |

Reserved semantic tokens (light/dark) are surfaced as CSS custom properties on `:root` / `.dark`:

- `--status-success-bg` / `--status-success-fg`
- `--status-warning-bg` / `--status-warning-fg`
- `--status-info-bg`    / `--status-info-fg`
- `--status-error-bg`   / `--status-error-fg`
- `--status-{tone}-border` for borders via `color-mix(in oklab, var(--status-{tone}-fg) 40%, transparent)`

Composition helpers live in `src/lib/tone.ts` (`toneChipClasses(flavor)` for Badge backgrounds, `toneBorderClass(flavor)` for borders, etc.). StatusBadge, Alert, and Toast compose via these helpers so the tonal vocabulary stays in sync from a single source of truth.

## Wordmark + chrome

- **Wordmark:** `sau@main`. Always lowercase, always in Plex Sans. Renders on the sidebar / mobile header / login card / `<title>`. The terminal-prompt `>_` is the only brand glyph; never substitute a lightning bolt, sparkles, "S", or any consumer icon.
- **Mono top breadcrumb:** `sau@main · build a7f3b21 · [●] ws ok · mainline`. `font-mono text-[11px] text-muted-foreground/80 tabular-nums`. The status dot color binds to `--status-success-fg`; the dot itself carries `aria-hidden` because its meaning is also conveyed by the literal "ws ok" text.
- **Pillow glyph rules:** use `·` (U+00B7 hairline middle dot) as separator in any mono metadata strip. Never `•` (U+2022 bullet), `-` (U+002D hyphen), `–` (U+2013 en dash), `—` (U+2014 em dash), or `|` (U+007C pipe).

## Boundaries — what's gone (and must not return)

- **`/marketing` subtree (warm-editorial palette)** — deleted in reset #3. No `src/marketing/`, no Newsreader, no ``.landing-theme`` scope. The paying-customer landing surface reinstated in round 4 is `src/Pages/LandingPage.tsx` — same engineering-tool aesthetic, copy reconceived as productivity-outcome to paying customers rather than dev-tool documentation.\n- **`/marketing` subtree is reinstated as `LandingPage.tsx`** — see `boundaries.marketing-surface` block for the banned-vocab list (no CLI / no Agent Skill / no install snippets / no mid-Chinese `Web Shell`), the aesthetic preservation rule (cold-neutral canvas + single sodium-amber accent + hairline borders + no glass/gradient/pulse), and the GitHub/MIT/stars formatting rule (customer-credibility social proof OK; mono-strip adjacency banned).
- **Newsreader serif** — removed from `index.html`. Sans-only system now.
- **Outfit / DM Sans / JetBrains Mono** — replaced by IBM Plex Sans / Plex Mono in reset #1.
- **Lavender / purple primary** — replaced by sodium amber in reset #1.
- **`.gradient-text`** — rule scaffold deleted from `src/index.css`; className usage scrubbed from every component.
- **`.glass`** — same.
- **`@keyframes subtle-pulse`** + `.status-running::after` halo — same.
- **FloatingLogs widget** — file deleted; lazy import + Suspense mount removed from `src/App.tsx`. Use dedicated `/logs` page.
- **Info-bg lavender** — replaced by steel-cyan in round post-3.

## Do's and Don'ts (operational rules)

### Do

- Reserve **`--primary` (sodium amber)** for brand mark, sidebar active strip, primary CTA, focus ring, link emphasis.
- Use **hairline borders** (1px solid `var(--border)`) on every chrome surface. Never drop shadow on flat surfaces.
- Use **`font-mono`** for IDs / counts / timestamps / build SHAs / status dots / the `>_` glyph.
- Use **sans (Plex Sans 400)** for body Chinese / English paragraphs.
- Use the **terminal-prompt `>_` glyph** as the only brand mark.
- Compose CTAs as **`rounded-md` 4px** corners, never pill.
- Use **`rounded-xl`** for shadcn `<Card>` (10px), **`rounded-md`** for buttons / inputs, **`rounded-lg`** for sidebar rows / dialog content, **`rounded-full`** only for StatusBadge.
- Test reads in dark mode explicitly. The amber accent shifts chroma in dark mode; never trust a light-mode-only paint.
- Use `·` (U+00B7 hairline middle dot) as separator in any mono metadata strip.
- Run `npx eslint` + `npx tsc --noEmit` + `npx vitest run src/App.test.tsx` before sign-off.

### Don't

- Don't introduce a **marketing surface** or warm-editorial palette.
- Don't introduce a **second chromatic accent**. Green/red beyond semantic; never orange / pink / gold for "brand warmth".
- Don't add **atmospheric gradients or spotlight cards**.
- Don't **pill-round CTAs (`rounded-full` on buttons)**.
- Don't reach for `Outfit` / `DM Sans` / `JetBrains Mono` / `Newsreader`.
- Don't use **lavender / purple / blue-rim glass** in any tone family (info-bg included).
- Don't put a **floating log console** in production chrome. Use the `/logs` route.
- Don't use `bg-foreground/[0.08]` as an active-row indicator — the sidebar uses a 2px hairline strip, not a fill.
- Don't introduce a **5th status semantic**.

## Iteration guide (extending the SYSTEM)

1. Open the file you want to change. Read the surrounding 50 lines as a system sample before editing.
2. **Adding a new token (color/elevation/spacing archetype):** declare it as a `--<name>` variable in `:root` (light) and `.dark` (dark) of `src/index.css`, alias it through `@theme inline` as `--color-<name>: var(--<name>)`, then use the Tailwind utility in components. Concrete 5-line diff:

   ```diff
   /* src/index.css */
   :root {
     --signal-warn: oklch(0.55 0.16 60);          /* light mode */
   }
   .dark {
     --signal-warn: oklch(0.72 0.14 60);          /* dark mode  */
   }
   @theme inline {
     --color-signal-warn: var(--signal-warn);     /* expose as utility */
   }
   /* usage: <span className="bg-signal-warn text-white">…</span> */
   ```

3. **Adding a new component:** mirror the shadcn pattern (`cva({variants})` for compound styling). Co-export of `cva({...})` variants alongside the React component breaks Fast Refresh — either keep the variant const module-local (canonical set today: `src/Components/ui/badge.tsx`, `button.tsx`, `alert.tsx`, `sheet.tsx`) or split into a sibling `*.variants.ts` file. Type-side escape hatch: `ComponentProps<typeof Badge>['variant']` (etc.) is still a public type. For `useState` ergonomics, prefer `NonNullable<ComponentProps<typeof Badge>['variant']>` to strip the trailing `| undefined` that `VariantProps<T>` adds onto optional props.
4. **Adding a 5th status:** don't. Update `src/lib/tone.ts` consumers first, but the 4-band contract is the system's invariant — extending it requires opening a separate design RFC.
5. **TypeScript compile contract (verbatimModuleSyntax):** `sau_web/frontend/tsconfig.app.json` runs in `verbatimModuleSyntax: true` paired with `erasableSyntaxOnly: true`. When the type system complains about a non-erasable type/import combo (typical in `*.test.ts(x)` and helper files), apply the 4-rung fallback ladder rather than splitting off `tsconfig.test.json`:
   1. `import type { X }` for types-only bindings.
   2. Mixed `import { type X, value }` when value + type are exported from the same module.
   3. Two imports from one module — one for the value, one `type`-only.
   4. Inline type-shape via `Parameters<typeof vi.fn()>` for VM-internal types we can't import cleanly (e.g. `vi.fn()` returns in test helpers).
   Do the per-file fix before reaching for a config split — the comment block at the top of `tsconfig.app.json` is the full source.
6. **Validation suite before sign-off:**
   - `pnpm exec tsc --noEmit`
   - `pnpm exec eslint . --ext .ts,.tsx`
   - `pnpm exec vitest run src/App.test.tsx`
   - `pnpm exec vite build`
7. **Resync docs when tokens move.** Don't let this file or `DESIGN-components.md` drift from `src/index.css` for more than one PR.

## Known open lint baseline (operational state)

Baseline JSON snapshot committed at `sau_web/frontend/scripts/.lint-baseline-after-render-harness.json` — captures the post-fix shape anchored by the most recent lint sweep. CI scripts that diff new lint output against this baseline should treat:

- Same `file × rule` pair as baseline = known-stable, allow re-occurrence.
- New `file × rule` pair = regression, fail CI.
- Removal of a listed `file × rule` pair = forward progress, fail-soft allowed.

Current per-file status:

- ✅ `src/features/auth/LoginPage.tsx` — `react-hooks/rules-of-hooks` was fixed (navigate-during-render replaced with `useEffect`, n=9 hooks).
- ✅ `src/Components/ui/badge.tsx` — `react-refresh/only-export-components` settled by going module-local (origin of the canonical pattern; see Iteration guide step 3).
- ✅ `src/Components/ui/button.tsx` — `react-refresh/only-export-components` settled by going module-local. `buttonVariants` is no longer exported; readers use `ComponentProps<typeof Button>['variant']` instead. See Iteration guide step 3 for the rationale + type-side escape hatch.
- ✅ `src/test/render-harness.tsx` — `only-export-components` settled by splitting helpers into `src/test/render-harness.helpers.ts`. The `.tsx` file now exports only `ProfilerWrap` + `TestProviders` (React components).
- ✅ `src/test/redirect-spy.tsx` — `only-export-components` settled by deletion. The `mountLoginPage` function moved to `src/test/login-render-helper.ts` (with `createElement` for the one-element render so the file stays `.ts` and the rule never fires); the interfaces moved to `src/test/login-render-helper.types.ts`.
- ✅ `src/hooks/useMobileDrawer.ts:48` — `react-hooks/set-state-in-effect` was fixed (auto-collapse moved into resize handler; setState-in-event-handler pattern).
- ✅ `src/hooks/usePublishDraft.ts:194` — `react-hooks/refs` was fixed (removed `snapshotRef.current = snapshot` during-render mirror; `writeSnapshot(currentSnapshot: T)` parameterized).
- ✅ `src/Components/ui/alert.tsx` + `src/Components/ui/sheet.tsx` — `cva()` recipes (`alertVariants`, `sheetVariants`) corroborated module-local via inline contract comment directly above the recipe. No lint violation but locked as a readable contract (drift-from-canonical is the failure mode the comment prevents).

- ✅ **OPT-follow-up-3-sweep-2 (resolved):** the 12 pre-existing `only-export-components` violations outside the render-harness scope were cleared by the same `*.tsx → *.tsx + *.helpers.ts` sibling-split shape used for `render-harness.tsx`. **Headline: `react-refresh/only-export-components × 12 → 0`** — 12 entries dropped from `scripts/.lint-baseline-after-render-harness.json`; the 12-entry pre-approved allowlist in `openspec/config.yaml` `rules.design` was retired in the same PR. Files resolved: `src/features/publish/shared.tsx` × 4, `src/features/accounts/AccountsProvider.tsx` × 3, `src/Components/ui/platform-icon.tsx` × 2, `src/Components/OnboardingTour.tsx` × 1, `src/Components/ThemeProvider.tsx` × 1, `src/Components/ui/toast.tsx` × 1. Bulk re-route of ~26 consumer imports across 21 files was driven by `scripts/split-imports-helpers.py` (single-pass, idempotent, defensive-guard verified — see Iteration guide step 7 for the operator runbook). Module-local cva set remains the canonical reference for the split template (badge/button/alert/sheet).
- ℹ Per-test-file lint noise (TaskTableRow, VideoForm, NoteForm, TaskDrawer) is not introduced by the design-system resets #1–#3.
