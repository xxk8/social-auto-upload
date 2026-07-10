// Type augmentation for the custom vitest matchers registered in
// `src/test/setup.ts` (replacement for @testing-library/jest-dom's
// matcher set). Each matcher signature mirrors the jest-dom one so
// call sites don't need to change.
//
// KEEP IN SYNC with src/test/setup.ts — adding a matcher to one
// and not the other causes "Property does not exist" at the call
// site. The inventory is the actual usage in the codebase (see
// `docs/tsc-error-baseline.txt` for the canonical tsc count).
//
// Note: `toBeInTheDocument` and friends are *regular* matchers, NOT
// asymmetric matchers (`expect.stringContaining(...)`). The earlier
// v1 of this file incorrectly declared them under
// `AsymmetricMatchersContaining` — that was dead type code and has
// been removed. Asymmetric-matcher *values* (used inside the
// `expected` argument) are supported at runtime in setup.ts via
// the `asymmetricMatch(expected, actual)` helper.

import 'vitest'

declare module 'vitest' {
  interface Assertion<T = unknown> {
    toBeInTheDocument(): T
    toHaveTextContent(text: string | RegExp): T
    toHaveValue(value: unknown): T
    toHaveAttribute(name: string, expected?: string | RegExp): T
    toBeDisabled(): T
    toBeChecked(): T
    toBeEnabled(): T
    toBeVisible(): T
    toContainElement(el: Element): T
  }
}
