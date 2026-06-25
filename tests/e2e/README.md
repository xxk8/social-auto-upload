# Playwright E2E Specs — OPT-3F / OPT-3G / OPT-3I

Three Playwright specs cover the cross-component flows shipped under
PR-OPT-3F + H + I + G:

| File | Covers | Assertion focus |
|------|--------|-----------------|
| `opt-3f-ai-collapse.spec.ts` | PR-OPT-3F | AI sidebar collapse → localStorage `sau-publish-ai-collapsed` flips → reload restores the rail layout |
| `opt-3g-chip-ring.spec.ts`   | PR-OPT-3G | Click `💡 N 项平台专属待配置` chip → Accordion opens → `#advanced-section-{platform}` gets `ring-2 ring-primary` |
| `opt-3i-cancel-navigate.spec.ts` | PR-OPT-3I | Submit → countdown pill visible → click 取消 → URL stays on `/publish` |

## Run

The Playwright webServer block assumes the Web Shell is already running
externally (per project convention). In another terminal:

```bash
bash sau_web/start.sh
```

Then in `sau_web/frontend/`:

```bash
pnpm e2e:install   # one-time: download chromium
pnpm e2e           # run all three specs
pnpm e2e:ui        # interactive UI mode
```

`E2E_BOOT_SERVER=1 pnpm e2e` lets Playwright manage the server's
lifecycle instead (useful in CI where you can't share the dev shell).

## Mocking discipline

Each spec sets up its own minimal `page.route()` mocks for `/api/*`.
Tests do **not** require a real backend, real accounts, or real cookies.
The 13 baseline TS errors and the Playwright types live independent of
each other; runtime smoke is the user's responsibility.

## Adding a new spec

Drop `opt-<id>-<slug>.spec.ts` next to these. The directory's testDir
is `e2e/` (configured in `playwright.config.ts`). Heroiocs: prefer
`role="button/region"` + `aria-label` selectors when the component
already advertises a11y; only fall back to `data-testid` for chips
that don't have a natural role.

## 🩺 Typecheck (no test execution)

Run from `sau_web/frontend/` so the pnpm-resolved tsc + node_modules
context is in scope (the `paths` and `typeRoots` aliases in
`tests/e2e/tsconfig.json` resolve against `sau_web/frontend/`):

```bash
cd sau_web/frontend
pnpm exec tsc --noEmit -p ../../tests/e2e/tsconfig.json
```

This verifies the 3 spec files compile against `@playwright/test` +
`@types/node` without launching any browser. To actually run the
specs, use `pnpm e2e` after `bash sau_web/start.sh`.
