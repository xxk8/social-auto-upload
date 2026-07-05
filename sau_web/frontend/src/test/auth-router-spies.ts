import { vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────
// Auth-router test spies — shared mock instances for tests that need to
// verify LoginPage's post-merge `navigate('/app/publish', { replace: true })`
// redirect contract.
//
// Why this file exists as a SEPARATE module from `redirect-spy.ts`:
//
//   1. `vi.hoisted` runs at module-init time, BEFORE the consumer's
//      `vi.mock(..., factory)` body evaluates. Test files declare
//      `vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }))`
//      where the factory closes over the spy. The spy therefore has to be
//      a stable imported value that's reachable from the factory's
//      lexical scope, AND must be created before any `vi.mock`
//      declaration runs. Importing spies from a dedicated module is the
//      canonical vitest pattern (the consumer's `vi.mock` declarations
//      are hoisted to the very top of its file, after imports).
//
//   2. Spy instances are PER test file (each `vi.hoisted` callback runs
//      once per module load, and each test file gets its own copy of
//      this module's evaluation). We deliberately do NOT share state
//      across test files — a fresh spy per test file means
//      `beforeEach(() => mockSpies.reset())` is local, and a flaky
//      test cannot poison siblings.
//
//   3. Hook-order + micro-render caveat: react-hook-form's
//      `useForm({ resolver: zodResolver(schema) })` creates a fresh
//      resolver on every render. Under happy-dom that resolver
//      identity change triggers an internal micro-render via
//      useForm's internal setState, so LoginPage's render-time
//      `if (isAuthenticated) { navigate('/app/publish', {replace:true}) }`
//      branch fires TWICE per mount (once on the initial render,
//      once on the RHF re-render). Tests that lock the redirect
//      **target** should assert with `toHaveBeenCalledWith(...)`,
//      never `toHaveBeenCalledTimes(1)` for Branch A. For Branch B
//      (inside the submit callback), count = 1 still holds. The full
//      breakdown lives in `redirect-spy.ts`'s docblock.
//
// IMPORTANT — vi.hoisted MUST NOT BE EXPORTED:
//
//   vitest's transformer recognises `const X = vi.hoisted(...)` and
//   hoists the RHS evaluation to the top of the file so the spies are
//   live BEFORE any vi.mock factory body executes. But the SAME
//   transformer refuses to track a hoisted value through an export:
//   `export const X = vi.hoisted(...)` produces the SyntaxError
//   "Cannot export hoisted variable". The fix below keeps the vi.hoisted
//   invocation non-exported (a module-local `_internal` const), and only
//   the dereferenced `vi.fn` references are exported under stable names.
//   The downstream consumer's vi.mock factories then close over regular
//   const imports — the transformer is happy with that.
// ─────────────────────────────────────────────────────────────────────────

const _internal = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseAuth: vi.fn(),
}))

export const mockNavigate = _internal.mockNavigate
export const mockUseAuth = _internal.mockUseAuth
