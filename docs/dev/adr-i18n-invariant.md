# ADR-001: i18n invariants for social-auto-upload (≥ zh-CN ⇆ en-US)

> Status: Accepted (round 1)
> Date: 2026-07-09
> Author: i18n architect pass

This ADR codifies the cross-cutting rules every i18n-aware PR must
follow. Each rule exists because a future refactor / copy rebrand /
translation drift would silently regress if the rule isn't enforced
mechanically or socially at review time.

---

## Rule 1 — `t()` is NEVER substituted into `data-*` attributes

**Status:** Mechanical (always-true invariant; lint cannot enforce
because the field name is `data-${any}`).

**Why this exists:** The existing test surface — see
`src/features/preferences/PreferencesDialog.test.tsx:580` — pins
`data-testid` to **machine keys** (`rowKey`, `'light' | 'dark' |
'system'`) AND the comment block explicitly states "(NOT the i18n
display label) An i18n migration (邮箱 → E-mail) would..."

Translation drift can flip `data-testid` values. Tests targeting
`getByTestId('email-row')` should still work, but `getByText('邮箱')`
anchors break. The same logic applies to `data-section-cell`,
`data-hero-cell`, `data-tier-card`, `data-reveal-cell`.

**The rule:**
- `data-testid`, `data-section`, `data-hero-cell`, `data-tier-card`,
  `data-reveal-cell`, etc. — keep verbatim.
- Display labels (the user-visible string) — go through `t()`.
- `aria-label` — IS user-visible; goes through `t()`. Exception:
  when the aria-label is a stable contract shared with screen-reader
  tests (`aria-label="切换语言"` vs `aria-label="Switch language"`
  both locate the same `<button>` by query, so the test reaches it
  differently — write the testid mirror as documented below).

**Verification pattern in tests:**

```tsx
// WRONG — locale-flip drift:
const trigger = screen.getByLabelText(t('locale.switch_label'))

// RIGHT — testid-scoped:
const trigger = screen.getByTestId('locale-picker-trigger')
expect(trigger).toHaveAttribute('aria-label', t('locale.switch_label'))
```

---

## Rule 2 — Keys live in `src/locales/<bcp47>.json`, never inline strings

**Why this exists:** Inline `t('\u4e00\u6761\u89c6\u9891', '一条视频')`
fallback values lead to the original Chinese string rotating back into
production in zh-CN locale when a key disappears from the JSON. The
`zh-CN.json` baseline file IS the source of truth for the Chinese
strings — adding Chinese via fallback hides gaps in the JSON.

**The rule:**
- `t('key')` only. No second `defaultValue` parameter.
- Every key in the JSX must appear in BOTH `zh-CN.json` and
  `en-US.json` before the PR is reviewed.
- Missing keys are reported in dev mode via i18next's
  `saveMissing: true` console.warn — left on for local dev, off in
  production via tree-shake on the env-flag detection.

---

## Rule 3 — `<Trans>` is reserved for rich-HTML interpolation; default to `t()`

**Why this exists:** The architect flagged `cva()` + `<Trans>`
type-error risk. cva variant strings only accept plain `string`, so
a `<Trans>` returning JSX inside a cva prop (e.g. `Badge variant=
{ <Trans>foo</Trans> }`) errors at compile.

**The rule:**
- Default to `const { t } = useTranslation()` and `t('key')` (returns
  `string`). Concatenate strings across JSX nodes for inline markup
  split-points (e.g. the LandingPage hero `<h1>headline_1
  headline_2 headline_3</h1>` is three `t()` strings joined in JSX).
- `<Trans>` only when the en/zh differ in HTML structure (rare:
  Link wrapping a word, `<strong>` emphasis, line break).
- Never inside a shadcn `variant={...}` or cva-prop.

---

## Rule 4 — Locale state contract

**Storage key:** `sau-ui-locale` (matches the `sau-ui-theme` /
`sau-accent-hue` precedent in `ThemeProvider.tsx`).

**Detection priority** (at boot):

1. `localStorage.getItem('sau-ui-locale')` if set & valid
2. `navigator.language` mapped via `foldBcp47()` to a Supported
3. `DEFAULT_LOCALE` = `'zh-CN'`

**Mutation:** ONLY via `<LocalePicker setLocale>` or future
PreferencesDialog → `display/locale` row. No `i18n.changeLanguage()`
direct calls from feature code outside this module.

---

## Rule 5 — Native-language picker labels

The `<LocalePicker>` always displays the locale's **native name**
("中文" / "English"), NOT the English translation of the locale
name. Future locales: `日本語` (ja) / `한국어` (ko). Argument from
the Round-VISION-FIX pass: "speak the visitor's language first."

---

## Rule 6 — `min-h-X` over `h-X` on translation-flexible blocks

**Why this exists:** The landing hero CTA button is `h-12 px-8`. EN
"Get started →" is wider than zh-CN "立即开始 →" (8 chars ≈ 4 trail
glyphs at 14 px). At ≥sm viewport the wider EN copy pushes the
button to its natural width — fine. At mobile (the existing
`Round-OPT-ios-hig-tap-target` 44×44 constraint), a widened button
into the bottom-nav no longer fits 36-px gutters.

**The rule:** When a button / pill's height modulates content size
(width doesn't matter as long as the text fits), use `min-h-X py-Y`
NOT `h-X`. Audit-pass suggested by the architect; not applied in
this round (the EN translations fit the unmodified CTAs).

---

## What this ADR does NOT cover (intentionally left for follow-ups)

- **Operator surface i18n** (Tasks/Publish/Calendar/AppShell chrome).
  Architect's MVP restricts the round-1 sweep to marketing chrome.
  Future PRs extract AppShell nav + UserMenu + 9-operator pages.
- **Date/number/currency formatting helpers.** `Intl.DateTimeFormat` /
  `Intl.NumberFormat` wrappers are a separate ADR after we land a
  Calendar i18n pass.
- **Server-side error messages.** Backend returns Chinese strings to
  frontend toasts for now. Future pass: `Accept-Language`-driven
  i18n on the Flask side.
- **Locale-aware timezone.** The browser already reports the correct
  timezone — UTC / 'Asia/Shanghai' just need explicit conversion in
  the date helpers, not the strings.

---

## References

- `docs/dev/VALUE-STRATEGY.md §3.3` — original i18n budget (3-5d)
- `src/features/preferences/PreferencesDialog.test.tsx:580-611` —
  data-testid machine-key precedent
- `src/Components/ThemeProvider.tsx:32-39` — `sau-ui-*` storage
  convention
- `openspec/config.yaml` — design contract surface (future toggle
  for `lint.i18n_no_data_attr`)
