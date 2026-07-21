import { vi, type Mock } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────
// Auth-router test spies — shared mock instances for tests that need to
// verify LoginPage's post-merge `{ to: '/dashboard/publish', replace: true }`
// redirect contract.
//
// Why this file exists as a SEPARATE module from `redirect-spy.ts`:
//
//   1. `vi.hoisted` runs at module-init time, BEFORE the consumer's
//      `vi.mock(..., factory)` body evaluates. Test files declare
//      `vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }))`
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
//      `if (isAuthenticated) { { to: '/dashboard/publish', replace:true } }`
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

// Default-useAuth return value: tests that don't explicitly
// `mockUseAuth.mockReturnValue(...)` get a fantasy authenticated
// admin out of the box. Without this, AuthGuard (called at first
// render by AppShell + many slice components) destructures
// `useAuth()` = undefined → throws TypeError → unmounts the
// entire test tree → empty `<body><div /></body>`. Tests that want
// the unauthenticated path override via `mockUseAuth.mockReturnValue(
// { isAuthenticated: false, ... })` — the vi.fn() ref is stable
// across tests so the per-test override still works.
//
// Type choice rationale: deliberately widen to `Mock<() => any>`.
// Three earlier rounds attempted narrowing — first plain object
// (overly strict returning shape -> 30+ TS2322 errors in tests that
// construct their own wider-shape user objects), then `as const`
// (readonly literal cascade -> same problem statement), then
// `vi.fn(() => ({ ... }))` with structural return inference
// (still narrows .mockReturnValue arg-type -> 14 remaining errors
// for tests like AppShell.setAuth({ user: null, … })). The
// `Mock<() => any>` annotation widens BOTH directions: any-typed
// .mockReturnValue argument AND any-typed return. This restores
// the pre-fix type contract where test files could pass any
// claimant shape (`{ user: null }`, `{ isAuthenticated: false }`,
// `{ name: 'Jane' }` etc.) without TS friction.
//
// Behavior contract is unchanged: tests that don't touch
// `mockUseAuth.mockReturnValue(...)` get the default authenticated
// admin shape; tests that DO call .mockReturnValue override the
// default impl wholesale (Vi .mockReturnValue replaces the impl,
// not extends).
const _internal = vi.hoisted(() => {
  const sendCode = vi.fn().mockResolvedValue({ success: true })
  const login = vi.fn().mockResolvedValue({ success: true })
  const logout = vi.fn().mockResolvedValue({ success: true })
  const mockUseAuth: Mock<() => any> = vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, email: 'test@example.com', role: 'admin' },
    isLoading: false,
    sendCode,
    login,
    logout,
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
  }))
  return { mockNavigate: vi.fn(), mockUseAuth, sendCode, login, logout }
})

export const mockNavigate = _internal.mockNavigate
export const mockUseAuth = _internal.mockUseAuth
