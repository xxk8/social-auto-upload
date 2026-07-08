# round-OPT-ios-hig-tap-target — visual evidence

Paired screenshots for the round-OPT-ios-hig-tap-target PR (BrandMark size bump from 28×28 to 36×36 at <sm viewport per iOS HIG tap-target).

| Viewport | Screenshot | Renders | Tested by |
|---|---|---|---|
| **320 × 568** (iPhone SE 1, @media (max-width: 639px)) | [`320px.png`](./320px.png) | BrandMark **36×36** (mobile HIG-adjacent) | `test (l)` layout-math: `expect(brandWidth).toBe(36)` |
| **768 × 1024** (iPad portrait, @media (min-width: 768px)) | [`768px.png`](./768px.png) | BrandMark **28×28** (conventional desktop density — `sm:h-7` / `sm:w-7` overrides flip back via @media source-order) | `test (m)` flip-back: `expect(...).toMatch(/\bsm:h-7\b/)` + `\bsm:w-7\b` + `.includes('sm:text-[13px]')` |

## Why pair both

A single screenshot at 320 px proves the mobile bump but doesn't prove the desktop flip-back. Pairing both prevents future regressions where:

- A future PR accidentally drops the `sm:h-7` / `sm:w-7` override → BrandMark would render 36×36 on desktop too (visual bloat).
- A future CSS refactor swaps source-order → `sm:` no longer wins, desktop renders 36×36.

If either regression appears, the matching screenshot's BCR-asserted dimensions (28×28 desktop / 36×36 mobile) will mismatch and the PR will fail review.

## 768px capture note

The 768 px capture was made on the auth-gated login page (`/login?redirect=%2F&reason=session_expired`) instead of the landing page (`/`), because the dev server had a stale session cookie + 401 from the prior `Login` test. The BrandMark chrome rendered on LoginPage is DOM-identical to the one on LandingPage (same `MarketingTopBar` component, same `BrandMark data-testid="marketing-brand-mark"` wrapper), so the 28×28 desktop-flip-back assertion is unaffected. The redirect does not change chrome dimensions.

Regenerating the 768 px screenshot on the landing page requires restarting the Flask backend with `SAU_AUTH_ENABLED=false` (or fresh `SAU_SECRET_KEY`) — out of scope for the BCR pair; revisit when auth-test isolation needs rev \u2192.
