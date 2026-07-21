---
version: post-reset-3 + post-pr-opt-final
name: sau-component-specs
status: per-component reference

description: |
  How to use the canonical components in `sau-web/frontend/`. Each component
  spec gives you the recipe (cva variants + sizes + key props), the do's,
  the don'ts, and accessibility patterns specific to that component.

scope: |
  This file covers the 9 components feature authors pick for the dashboard
  surface: Button, Card, Input, Popover, Dialog, SidebarRow, StatusBadge,
  ProgressBar, Toast. Looking for WHY these components look the way they do,
  or how to add a new component to the system? Read DESIGN.md (system-level).
  Looking for HOW to render a dialog or a status badge today? You're in
  the right place.

# ─────────────────────────────────────────────────────────────────────────
# Recipe notation:
#
#  • "Recipe" section is the canonical <X> usage with `cva` variants.
#  • "Do" section is the contract you must satisfy when authoring.
#  • "Don't" section lists anti-patterns this component guards against.
#  • "Accessibility" section names the a11y contract: roles, aria-attrs,
#    keyboard handlers, screen-reader expectations.
#
# All recipes cross-reference DESIGN.md for system reasons; use the cross-
# reference instead of re-deriving from tokens.
# ─────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────
# 1. Button
# ─────────────────────────────────────────────────────────────────────────
Button:
  source: src/Components/ui/button.tsx
  imports: |
    import { Button } from '@/Components/ui/button'
  base-className: |
    inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md
    text-sm font-medium transition-colors focus-visible:outline-none
    focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none
    disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0
  variants:
    variant:
      default:     "bg-primary text-primary-foreground shadow hover:bg-primary/90"
      destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
      outline:     "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground"
      secondary:   "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80"
      ghost:       "hover:bg-accent hover:text-accent-foreground"
      link:        "text-primary underline-offset-4 hover:underline"
    size:
      default: "h-9 px-4 py-2"          # canonical CTA size
      sm:      "h-8 rounded-md px-3 text-xs"  # dense tables, inline actions
      lg:      "h-10 rounded-md px-8"          # hero / single-action pages
      icon:    "h-9 w-9"                       # icon-only CTAs (paired with aria-label)
  props:
    asChild: "Render as Radix Slot (pass `href`/`to` from react-router). When true, Button must be the SOLE child of the wrapper."
    loading: "Renders spinner SVG inside the button AND sets disabled. Use while awaiting an async submit."
  recipe-examples:
    primary-cta: '<Button type="submit" loading={isPending}>发布</Button>'
    icon-only:   '<Button variant="ghost" size="icon" aria-label="关闭"><X className="h-4 w-4" /></Button>'
    as-link:     '<Button asChild variant="link"><Link to="/dashboard/tasks">查看任务</Link></Button>'
  recipe-supply-chain: |
    The cva recipe driving these variants is the module-local `buttonVariants`
    const in `button.tsx`. It is consumed by `<Button>` AND by the
    `ButtonProps['variant'] | ButtonProps['size']` prop union (via
    `VariantProps<typeof buttonVariants>`) but is intentionally **not
    re-exported** from the module. Downstream code composes <Button> with
    `variant` / `size` props; importing `buttonVariants` from this module
    is no longer an exported API and is therefore unsupported.

    If a feature genuinely needs button-like styling outside `<Button>`:

    1. **Wrap `<Button asChild>`** for styled-link cases (`<Link>`,
       `<a>`, custom router links). This is the default — visually
       identical to `<Button>` and inherits every variant/size for free.
    2. **Propose a new variant on `ButtonProps`** if the styled element
       is genuinely button-shaped but not a `<button>`/`<a>` (e.g., a
       custom trigger). Don't fork silently — drift between snapshot
       styling and the canonical Button is a known regression.
    3. Forking a feature-local `cva()` clone is **deprecated** even as an
       escape hatch: any reader reaching for the recipe will grep against
       a non-exported const and silently drift when `button.tsx` tunes.
       This invariant is the reason `buttonVariants` is module-local.

    **Type-side escape hatch (NOT deprecated):** if you only need the
    variant/size *type unions* (e.g., to type a `useState` or a Form
    schema), `ButtonProps` is an exported interface so you can index
    `ButtonProps['variant']` / `ButtonProps['size']` directly. The
    callable recipe is what's gated; the prop literals are public. Note
    that `VariantProps<T>` exposes both as optional — `ButtonProps['variant']`
    has a trailing `| undefined` — so for `useState<ButtonProps['variant']>`
    ergonomics, prefer `NonNullable<ButtonProps['variant']>` to strip the
    trailing `undefined`.

    If you're sure you need path (3), gate it behind a tracked issue that
    lists the variant(s) you want promoted to `ButtonProps`, then merge
    only after the promotion lands.
  do:
    - "Use `variant=default` for ONE primary action per surface (the page's hero action)."
    - "Use `destructive` only for actually-destructive actions (delete, revoke, logout). Confirm-on-action is upstream of this — Button just renders the affordance."
    - "Use `loading={isPending}` rather than building your own spinner inside the button."
    - "Use `aria-label` on icon-only buttons (`size=icon`)."
    - "Use `asChild` when the visual Button wraps a route link (`<Link to=...>`) or an external `<a>`."
  dont:
    - "Don't pill-round a Button (`rounded-full`) — see DESIGN.md 'pill-rounded CTAs' rule."
    - "Don't add a `shadow-lg` to a Button. `shadow` (default) or `shadow-sm` (other variants) is the ceiling."
    - "Don't put an icon-only button without `aria-label`."
    - "Don't co-render a spinner INSIDE the button while `loading=true` — Button renders its own spinner."
  lint: "`buttonVariants` is module-local to `button.tsx`; only `<Button>` is exported. This satisfies `react-refresh/only-export-components`. Don't add NEW components that co-export a React component AND a cva variant const — split into a `*.variants.ts` sibling or keep the const module-local (the same pattern as `badge.tsx`)."
  accessibility:
    focus: "focus-visible:ring-1 focus-visible:ring-ring — sodium amber halo at 3px-effective focus"
    disabled: "Disabled state is keyed off `disabled || loading`. Both flip `disabled` and `opacity-50`."
    keyboard: "Native `<button>` ← uses Enter/Space natively. Icon-only buttons must carry `aria-label` because Enter/Space has no visible text cue."

# ─────────────────────────────────────────────────────────────────────────
# 2. Card
# ─────────────────────────────────────────────────────────────────────────
Card:
  source: src/Components/ui/card.tsx
  sub-components: [Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter]
  imports: |
    import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/Components/ui/card'
  base-className: 'rounded-xl border bg-card text-card-foreground shadow'
  recipe-examples:
    simple-card: |
      <Card>
        <CardHeader>
          <CardTitle>账号组</CardTitle>
          <CardDescription>今日新增 2 个账号</CardDescription>
        </CardHeader>
        <CardContent>
          {/* body */}
        </CardContent>
      </Card>
    dense-card: |
      <Card className="rounded-lg p-0"> {/* override to rounded-lg for dense lists */}
        <div className="divide-y">
          {/* table-row style content */}
        </div>
      </Card>
  do:
    - "Use `<Card>` + `<CardHeader>` + `<CardContent>` for panel-style content (KPI cards, account group cards, dialog-like surfaces)."
    - "Use `rounded-xl` (10px) for the canonical card. Override to `rounded-lg` (6px) only for dense list-style cards."
    - "Pair with `border` (hairline) + `shadow` — never add `shadow-lg` to cards in this system."
  dont:
    - "Don't pill-round a card. `rounded-full`/`rounded-2xl`/`rounded-3xl` are all forbidden on cards."
    - "Don't use `shadow-md` / `shadow-lg` on cards. Depth comes from surface ladder + hairline borders."
    - "Don't put display-grid content directly inside Card without CardContent — keeps the `p-6` chrome consistent."
    - "Don't use the legacy `.card-refined` CSS class for new surfaces — phased out; use `<Card>` from card.tsx."
  accessibility:
    roles: "Card is a `<div>`. If the card is interactive (clickable area), wrap in a `<button>` or `<a>` with `<Card>` inside, OR use `role=\"button\"` + `tabIndex={0}` + keyboard handler."
    heading: "Use `<CardTitle>` for the visible title; this maps to a `<div>` with `font-semibold leading-none tracking-tight` — visually styled as a heading but NOT a semantic `<h2>`. If a screen-reader heading hierarchy matters, use a real `<h2>`/`h3>` inside CardHeader and style it manually."
    contrast: "`bg-card` resolves to `--card` token. Border resolves to `--border`. Both meet WCAG AA on light AND dark canvases per the OKLCH values documented in DESIGN.md."

# ─────────────────────────────────────────────────────────────────────────
# 3. Input
# ─────────────────────────────────────────────────────────────────────────
Input:
  source: src/Components/ui/input.tsx
  imports: 'import { Input } from "@/Components/ui/input"'
  base-className: |
    flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1
    text-base shadow-sm transition-colors file:border-0 file:bg-transparent
    file:text-sm file:font-medium file:text-foreground
    placeholder:text-muted-foreground focus-visible:outline-none
    focus-visible:ring-1 focus-visible:ring-ring
    disabled:cursor-not-allowed disabled:opacity-50 md:text-sm
  props:
    type: "Native HTML input type — text, email, password, file, etc. The component is a forwardRef'd `<input>`."
    placeholder: "Inherits `text-muted-foreground`. NEVER red placeholder — placeholder hint means informational, not error."
  recipe-examples:
    text-input: '<Input placeholder="账号名称" value={name} onChange={...} />'
    file-input: '<Input id="video-file-input" type="file" accept="video/*" />'
  do:
    - "Use `<Input>` for single-line text/email/password fields."
    - "Pair with a visible `<Label>` (from `@/Components/ui/label`) — placeholder alone is NOT sufficient labelling."
    - "Use `aria-invalid` and a danger border (variant extension) when the field has failed validation."
    - "Use `autoComplete` where the browser can suggest values — most login forms benefit."
  dont:
    - "Don't replace the focus ring (`focus-visible:ring-1 focus-visible:ring-ring`) with a chrome-coloured ring. The amber ring is the system's contract — focus state should not look like section chrome."
    - "Don't add `shadow-md` / `shadow-lg` to an Input. `shadow-sm` (native) is the ceiling."
    - "Don't use `rounded-lg` or `rounded-xl` on Input. `rounded-md` (4px) is the canonical input radius (canonical for buttons AND inputs)."
  accessibility:
    label: "Visible `<Label>` linked via `htmlFor` OR `<Input aria-label>` — placeholder alone fails a11y tests."
    error: "`aria-invalid={true}` plus `<p role=\"alert\">` with the error. Border color extension is the visual cue; aria-invalid is the SR cue."
    keyboard: "Native `<input>` keyboard semantics. Enter submits parent form unless `type=button`/`type=submit` are explicit."
    placeholder-a11y: "Placeholder text disappears on focus — do NOT communicate required/redundant info via placeholder alone. Use `aria-describedby` + a sibling description element."

# ─────────────────────────────────────────────────────────────────────────
# 4. Popover
# ─────────────────────────────────────────────────────────────────────────
Popover:
  source: src/Components/ui/popover.tsx
  based-on: "@radix-ui/react-popover"
  sub-components: [Popover, PopoverTrigger, PopoverContent]
  imports: |
    import { Popover, PopoverTrigger, PopoverContent } from '@/Components/ui/popover'
  base-className: |
    z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground
    shadow-md outline-none data-[state=open]:animate-in
    data-[state=closed]:animate-out data-[state=closed]:fade-out-0
    data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95
    data-[state=open]:zoom-in-95
    data-[side=bottom]:slide-in-from-top-2
    data-[side=left]:slide-in-from-right-2
    data-[side=right]:slide-in-from-left-2
    data-[side=top]:slide-in-from-bottom-2
  props:
    align: "Radix `align` union — start | center | end. Default `center`."
    sideOffset: "px offset from the trigger. Default `4`."
  recipe-examples: |
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost">选择账号组</Button>
      </PopoverTrigger>
      <PopoverContent>
        {/* selection list */}
      </PopoverContent>
    </Popover>
  do:
    - "Use for transient UI anchored to a trigger (account picker, status filter, column-config)."
    - "Use `asChild` on PopoverTrigger when the trigger is a Button — keeps the event handler chain clean."
    - "Pair with a sensible `align` value: dropdown-like pickers usually use `start` (left-aligned); tooltips use `center`."
  dont:
    - "Don't use Popover for modal-blocking content — that's Dialog."
    - "Don't render an interactable form INSIDE a Popover that mutates data on close without an explicit Apply/Cancel — Popovers commit-on-render by default."
    - "Don't add `shadow-lg` to PopoverContent. `shadow-md` (native) is the ceiling."
  accessibility:
    keyboard: "Radix handles Esc-to-close and outside-click-to-close. Focus returns to trigger on close."
    role: "Radix exposes `role=\"dialog\"` semantics. Aria-labelled via `aria-label` on PopoverContent or `aria-labelledby` referencing a sibling heading."
    motion: "Prefer reduced-motion media queries — the slide-in animation honors `prefers-reduced-motion` via `src/index.css` `@media` block (animation-duration: 0.01ms)."

# ─────────────────────────────────────────────────────────────────────────
# 5. Dialog
# ─────────────────────────────────────────────────────────────────────────
Dialog:
  source: src/Components/ui/dialog.tsx
  based-on: "@radix-ui/react-dialog"
  sub-components: [Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogOverlay, DialogPortal]
  imports: |
    import {
      Dialog, DialogTrigger, DialogClose, DialogContent,
      DialogHeader, DialogFooter, DialogTitle, DialogDescription,
    } from '@/Components/ui/dialog'
  base-className:
    overlay: 'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
    content: |
      fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg
      translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6
      shadow-lg duration-200 ... sm:rounded-lg
    note-on-radius: "Content uses `sm:rounded-lg` (6px) on desktop (≥640px); mobile is full-bleed zero-radius by design. This is a screen-size-driven radius, NOT a token override."
  props:
    title-required: "DialogContent MUST have a child <DialogTitle> for screen-reader announcement."
    description-recommended: "DialogDescription is optional but recommended for destructive or non-trivial dialogs — communicates what happens on confirm."
  recipe-examples: |
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">删除账号组</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>该账号组下的 3 个账号将被解绑，且无法撤销。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={...}>取消</Button>
          <Button variant="destructive" onClick={confirmDelete}>确认删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  do:
    - "Always include `<DialogTitle>` — required for screen-reader announcement."
    - "Wrap long-form actions in `<DialogFooter>`; it lays out as `flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2`."
    - "Use `bg-black/80` for the overlay. This is `index.css` convention; do NOT lift modal backdrop to a non-dimmed overlay."
    - "For destructive confirm dialogs, default focus to the cancel button via Radix `onOpenAutoFocus`."
  dont:
    - "Don't render a Dialog without a `<DialogTitle>` — even if you have only an icon. Title is required for screen readers."
    - "Don't substitute a custom modal — the Radix Dialog handles focus trap, escape-to-close, and aria-modal correctly. Going custom breaks all three."
    - "Don't change the overlay opacity (`bg-black/80`) — modal backdrop presence is the contract."
    - "Don't add `shadow-2xl` to DialogContent — `shadow-lg` (native) is the ceiling."
  accessibility:
    role: "Radix exposes `role=\"dialog\"` + `aria-modal=\"true\"` on DialogContent (and Overlay carries `aria-hidden`)."
    title-required: "<DialogTitle> is required. Without it, screen readers cannot announce the dialog's purpose on open."
    focus-return: "Radix restores focus to the trigger element when the dialog closes."
    keyboard: "Esc closes the dialog. Native Tab traps focus within the dialog while open."

# ─────────────────────────────────────────────────────────────────────────
# 6. SidebarRow
# ─────────────────────────────────────────────────────────────────────────
SidebarRow:
  source: src/App.tsx (the AppShell sidebar nav row pattern, lines ~325–365)
  imports: "No import — pattern is inline in AppShell. If extracted to a sibling component, prefer '@/Components/SidebarRow' or './SidebarRow'."
  base-className: |
    group relative flex items-center rounded-lg text-[13px] font-medium
    transition-all duration-150 px-2.5 py-2 mx-0.5 gap-2.5
  states:
    active: |
      className: "text-foreground"  (NO row-level fill — see chrome-patterns.sidebar-active-row in DESIGN.md)
      child-strip: 'absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full bg-primary'
    inactive: 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
    collapsed: |
      active: 'justify-center px-2 py-2 mx-0.5'
      inactive: 'justify-center px-2 py-2 mx-0.5 text-muted-foreground hover:text-foreground'
      tooltip: |
        absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-foreground
        text-background text-xs font-medium opacity-0 group-hover:opacity-100
        pointer-events-none transition-all duration-150 whitespace-nowrap z-50
        shadow-lg scale-95 group-hover:scale-100
  props:
    label: "Visible row label (Chinese or English). e.g. '账号管理', '发布中心'."
    icon: "Lucide icon component. e.g. Users, Send, BarChart3, LineChart, FileText."
    path: "React Router path. e.g. '/dashboard/publish'. Active detection is `pathname === path`."
    isActive: "Computed from `location.pathname === path` (NOT from a prop). The row is active by location, not by feature flag."
    tour-anchor: "Use `data-tour='nav-publish'` (or similar) to expose the row to the OnboardingTour step anchors."
  recipe-examples:
    desktop-row: |
      <Link
        to={item.path}
        className={cn(
          'group relative flex items-center rounded-lg text-[13px] font-medium transition-all duration-150',
          'px-2.5 py-2 mx-0.5 gap-2.5',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
        )}
        data-tour={item.path === '/publish' ? 'nav-publish' : undefined}
      >
        {active && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full bg-primary" />
        )}
        <Icon className={cn('h-4 w-4 shrink-0 transition-colors duration-150', active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')} />
        <span className={cn('truncate transition-colors duration-150', active && 'font-medium')}>
          {item.label}
        </span>
      </Link>
  do:
    - "Use the active = pathname === path comparison rule."
    - "Apply the active-strip child div ONLY when {active &&…} — never hoisted outside the guard."
    - "Hover tint is `hover:bg-foreground/[0.04]` — subtle hover-only, NEVER applied as a steady-state."
    - "Use `data-tour='nav-publish'` (or your step-specific anchor id) on the publish row's nav item so the OnboardingTour can latch onto it."
    - "Use `text-foreground` (full ink) instead of `text-primary` for the active row's text color — the strip is the amber cue, the text is just ink."
  dont:
    - "Don't apply `bg-foreground/[0.08]` or any other row-level fill on the active row. That's the pre-reset (Linear-style) block-fill and was deliberately removed."
    - "Don't apply `text-primary` to the row's label. `text-primary` is reserved for the strip — text color should always be `text-foreground` / `text-muted-foreground`."
    - "Don't omit the active-strip child div. Without it, active state reads identically to a hover state on dark backgrounds."
  accessibility:
    active-announce: "Active row is announced by `<Link>` aria-current when needed. Currently NO aria-current is rendered — add `aria-current={active ? 'page' : undefined}` if SR users need explicit active-state announcement."
    keyboard: "Native `<Link>` semantics — Tab/Shift-Tab navigate between rows; Enter activates the route."
    focus: "Focus state relies on default browser focus rings. Add `focus-visible:ring-1 focus-visible:ring-ring` if you replace the row's `<Link>` with a custom wrapper."

# ─────────────────────────────────────────────────────────────────────────
# 7. StatusBadge
# ─────────────────────────────────────────────────────────────────────────
StatusBadge:
  source: src/Components/ui/badge.tsx
  imports: 'import { Badge } from "@/Components/ui/badge"'
  base-className: |
    inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs
    font-semibold transition-colors focus:outline-none focus:ring-2
    focus:ring-ring focus:ring-offset-2
  variants:
    secondary:   "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80"
    destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80"
    outline:     "text-foreground"
    success:     "border-transparent + toneChipClasses('success')"   # semantic palette
    warning:     "border-transparent + toneChipClasses('warning')"   # semantic palette
    info:        "border-transparent + toneChipClasses('info')"      # semantic palette — steel-cyan
    error:       "border-transparent + toneChipClasses('error')"     # semantic palette
  tonal-vocabulary-source: "src/lib/tone.ts (toneChipClasses / toneBorderClass). Adding a tone means extending the 4-band contract in DESIGN.md — review that file first."
  props:
    variant: "Required for semantic; defaults to `secondary` (neutral chrome)."
  recipe-examples:
    success: '<Badge variant="success">已连接</Badge>'
    info:    '<Badge variant="info">轮询中</Badge>'
    neutral: '<Badge variant="secondary">未登录</Badge>'
  do:
    - "Use a 4-band semantic variant (success/warning/info/error) when communicating a state derived from `rateToTone`."
    - "Use `secondary` (default) for chrome pills that aren't state-driven (e.g., column headers in dense tables)."
    - "Pair with text, not just an icon — the badge is a vocabulary carrier."
  dont:
    - "Don't introduce a 5th semantic variant. The 4-band contract is the system's invariant."
    - "Don't use StatusBadge for a CTA. Use `<Button>` for click-driven action; StatusBadge IS a state vocabulary carrier."
    - "Don't override the radius to anything other than `rounded-full` — StatusBadge IS the canonical pill surface."
  accessibility:
    semantics: "Renders a `<div>`. If the badge communicates state to SR users, include explicit text (the badge's `children` is the SR-readable content). For purely-status badges, set `role=\"status\"` and ensure aria-label or visible text conveys the meaning."
    focus-ring: "focus:ring-2 focus:ring-ring focus:ring-offset-2 — sodium-amber halo, focused is intentional even on non-interactive badges (assistive swipe-to-focus)."

# ─────────────────────────────────────────────────────────────────────────
# 8. ProgressBar
# ─────────────────────────────────────────────────────────────────────────
ProgressBar:
  source: src/Components/ui/progress.tsx
  imports: 'import { Progress } from "@/Components/ui/progress"'
  base-className:
    root:     'relative h-2 w-full overflow-hidden rounded-full bg-primary/20'
    fill:     'h-full w-full flex-1 bg-primary transition-all'
    technique: "Fill width is animated via inline `style={{ transform: translateX(-X%) }}` — NOT via `width` mutations. This avoids layout thrash."
  props:
    value: "Current value (number). Defaults to 0."
    max:   "Maximum value (number). Defaults to 100."
    indicatorClassName: "Optional override for the indicator's color. Use only when `<Progress>` is rendering something other than `bg-primary` (e.g., amber-tinted vs. semantic-tinted bars)."
  recipe-examples:
    standard: '<Progress value={45} max={100} />'
    with-label: |
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>上传进度</span>
          <span className="font-mono tabular-nums">{45}%</span>
        </div>
        <Progress value={45} />
      </div>
  do:
    - "Use `<Progress>` for any linear progress surface (upload progress, task progress, polling progress)."
    - "Pair with a small mono-numeric label (font-mono tabular-nums) above/below — visibility into the actual value as a number, not just the bar."
    - "Use `indicatorClassName` only when the bar needs a semantic color (success-warning-error) instead of the canonical primary amber."
  dont:
    - "Don't animate via `width` mutations. The component animates via `transform: translateX()` to avoid layout thrash — preserve this contract."
    - "Don't use a height > h-2 (`h-3`, `h-4`) — progress bars are dense chrome. For taller surfaces, use a Card with an embedded progress."
    - "Don't render Progress inside a non-shimmer indeterminate context without `value` — indeterminate progress requires a separate visual idiom (e.g., animated stripe pattern or spinner ring)."
  accessibility:
    role: "Renders `role=\"progressbar\"` with `aria-valuemin={0}` / `aria-valuemax={max}` / `aria-valuenow={value}` — manual SR announcement of progress is automatic."
    label: "Pair with a visible label (sibling text) so SR users hear both the percentage and the context."
    indeterminate: "If progress is indeterminate (no value), use `role=\"progressbar\" aria-busy=\"true\"` + an animated visual cue. This component is for DETERMINATE progress only."

# ─────────────────────────────────────────────────────────────────────────
# 9. Toast
# ─────────────────────────────────────────────────────────────────────────
Toast:
  source: src/Components/ui/toast.tsx
  imports: |
    import { ToastProvider, useToast } from '@/Components/ui/toast'
  anatomy:
    ToastProvider: "Top-level provider; mount ONCE above routes (currently in App.tsx TooltipProvider→ToastProvider→AccountsProvider chain)."
    useToast: "Hook returning { toasts, addToast, removeToast }. Call from any descendant of ToastProvider."
    ToastContainer: "Renders fixed top-4 right-4 z-[100] container with all toasts. Internal to ToastProvider — do not render separately."
    ToastItem: "Individual toast; renders CheckCircle / XCircle / AlertTriangle / Info icon + text + close button. Internal to ToastContainer."
  toast-types:
    default: "bg-background + border. No icon. Use for neutral confirmations."
    success: "bg-(--status-success-bg) + fg(--status-success-fg) + CheckCircle icon."
    error:   "bg-(--status-error-bg) + fg(--status-error-fg) + XCircle icon."
    warning: "bg-(--status-warning-bg) + fg(--status-warning-fg) + AlertTriangle icon."
    info:    "bg-(--status-info-bg) + fg(--status-info-fg) + Info icon. NEVER use for warning-state — use `warning`."
  props:
    message: "Toast text. Single line; long strings will be ellipsized by the row's flex-1 + the close button."
    type:    "One of { default | success | error | warning | info }. Defaults to `default`."
  recipe-examples:
    consume: |
      const { addToast } = useToast()
      await publishMutation.mutateAsync(...)
      addToast('已发布到 3 个平台', 'success')
  do:
    - "Wrap `<App>` (or the dashboard shell) in `<ToastProvider>` once. AppShell currently does this via the App.tsx chain — extending the shell requires keeping ToastProvider above AuthGuard."
    - "Pair with `useToast()` for ad-hoc feedback from event handlers."
    - "Use the 4-band semantic types for state-derived feedback. Use `default` for non-state messages."
  dont:
    - "Don't render `<ToastProvider>` more than once in the AppTree — double-mount causes two containers to flash duplicate toasts."
    - "Don't use Toast for blocking modal content. Use Dialog."
    - "Don't manually call `removeToast` immediately after `addToast` — the auto-dismiss timer (3s default) + 300ms exit animation handles cleanup. Manual close uses dismissToast which respects the exit animation."
  accessibility:
    role: "Container renders `z-[100]` so toasts overlay content. Each ToastItem has `aria-label=\"关闭通知\"` on the close button."
    live-announce: "Toast content is announced by SR via the focus-ring trail. For state feedback that needs SR announcement BEFORE user interaction, set the toast's text to be self-evident (`操作失败：cookie 已失效` vs. `错误`)."
    keyboard: "Toast close button is keyboard-focusable. Native `<button>` semantics. No Esc-to-close-all binding (each toast has its own dismissal); consider exposing a global Cmd+K shortcut via `<CommandPalette>` only if you need it."

# ─────────────────────────────────────────────────────────────────────────
# Cross-cutting rules
# ─────────────────────────────────────────────────────────────────────────
cross-cutting:
  shadcn-fast-refresh:
    rule: |
      Components exported from `*.tsx` files MUST NOT co-export cva-variants
      alongside the React component — that breaks Vite Fast Refresh.
      Either keep the variant const module-local OR split it into a sibling        `*.variants.ts` file. The badge.tsx regression was fixed by going
        module-local; the Button recipe now follows the same pattern
        (post-OPT-button-fix).
        Cross-reference: openspec/config.yaml `rules.design` governs PR-side
        enforcement; DESIGN.md (Iteration guide step 3 + step 5) is the
        system-level tutorial + typed escape hatch walkthrough.
    sweep-status: |
      **Sweep: render-harness scope closed**. The 2 named violations the
      user originally pointed at (`src/test/render-harness.tsx` x2,
      `src/test/redirect-spy.tsx` x1) are gone. Files switched to
      module-local helpers/components in this PR:
        - `src/test/render-harness.tsx` — split helpers out to
          `src/test/render-harness.helpers.ts` (per-rule shape). The
          `.tsx` file now exports only `ProfilerWrap` + `TestProviders`.
        - `src/test/redirect-spy.tsx` — deleted; replaced by
          `src/test/login-render-helper.ts` (single function-export,
          JSX converted to `createElement` so the file stays `.ts` and
          the rule never fires) + `src/test/login-render-helper.types.ts`
          (interfaces only).
      Surfaced bonus: 4 adjacent `@typescript-eslint/no-unused-vars`
      violations (Profiler onRender's trailing `_actualDuration`/
      `_baseDuration`/`_startTime`/`_commitTime`) cleared by adding
      `argsIgnorePattern: '^_'` to `eslint.config.js` (top-level
      `rules:` block — simpler than the original map-and-spread). Now
      consistent with the convention used in `src/test/setup.ts` and
      `src/stores/useAiStore.ts`.

      **Module-local cva — verified file set** (corroborated not just
      by lint silence but by inline contract comments — see source
      for the rationale block above each `cva()`):
        - `src/Components/ui/badge.tsx` — `badgeVariants` (origin)
        - `src/Components/ui/button.tsx` — `buttonVariants` (post-fix)
        - `src/Components/ui/alert.tsx` — `alertVariants` (corroborated)
        - `src/Components/ui/sheet.tsx` — `sheetVariants` (corroborated)
      All four keep the cva() recipe non-exported. Drift contract: a
      feature-local cva() clone forks from a recipe readers can't
      import, so the source-of-truth stays grep-able. Type-side
      escape hatch (`ComponentProps['variant']`) stays public.

      **Sweep: OPT-follow-up-3-sweep-2 (resolved).** The 12 pre-existing
      `only-export-components` violations surfaced by the wider audit
      were cleared by the same `*.tsx → *.tsx + *.helpers.ts`
      sibling-split template the render-harness fix pioneered. **Headline:
      `react-refresh/only-export-components × 12 → 0`** — matches the
      cleared entry in DESIGN.md `Known open lint baseline`. Files
      resolved: `src/features/publish/shared.tsx` × 4,
      `src/features/accounts/AccountsProvider.tsx` × 3,
      `src/Components/ui/platform-icon.tsx` × 2,
      `src/Components/OnboardingTour.tsx` × 1,
      `src/Components/ThemeProvider.tsx` × 1,
      `src/Components/ui/toast.tsx` × 1. The bulk re-route of ~26
      consumer imports across 21 downstream files was driven by
      `scripts/split-imports-helpers.py` (single-pass, idempotent,
      defensive-guard verified — re-run is a no-op). The 12-entry
      pre-approved allowlist in `openspec/config.yaml` `rules.design`
      was retired in the same PR; only the canonical module-local cva
      set (badge/button/alert/sheet) and the now-resolved sweep scope
      remain.

      **tsconfig.app.json verbatimModuleSyntax** — `true` (bundler
      strict mode; `erasableSyntaxOnly: true` paired with it). The
      top-of-file comment in `tsconfig.app.json` documents the four
      fallback rungs when used by tests / helpers:
        1. `import type` for types-only.
        2. mixed `import { type Foo, bar }` for value+type shared module.
        3. two imports from one module (one value, one type-only).
        4. inline type-shape via `Parameters<...>` for VM-internal
           types we can't import cleanly (e.g. `vi.fn()`).
      Don't split into `tsconfig.test.json` until the per-file fix
      proves more costly than the config-split cost.

      Baseline JSON snapshot committed at
      `sau_web/frontend/scripts/.lint-baseline-after-render-harness.json`.
      It captures the post-fix state after OPT-follow-up-3-sweep-2
      cleared; CI scripts that compare new lint output against this
      baseline should treat same `file × rule` pairs as known-stable,
      new pairs as regression, and removed pairs as forward progress.
      Cross-reference: DESIGN.md (`Known open lint baseline`) is the
      authoritative current-state snapshot + CI failure rules; the
      cleared OPT-follow-up-3-sweep-2 entry holds the `× 12 → 0`
      headline. `tsconfig.app.json` top-of-file comment is the
      verbatim-module-syntax ladder source; `openspec/config.yaml`
      `rules.design` is the PR-side enforcement view (and carries the
      retired-allowlist breadcrumb that replaced the 12-entry list).
  testing-harness:
    source: src/test/render-harness.tsx (TestProviders — wraps QueryClient)
    known-limitation: "TestProviders does NOT currently wrap with ToastProvider. Tests that mount components consuming useToast throw `useToast must be used within a ToastProvider`. Wrap ad-hoc in tests that need toasts (PublishPage.test.tsx is the canonical currently-broken example)."
