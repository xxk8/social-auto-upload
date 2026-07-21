// ──────────────────────────────────────────────────────────────────────────
// test-utils/MemoryRouter.tsx
//
// Backward-compatible shim for the 30 test files that historically used
// `react-router-dom`'s `<MemoryRouter initialEntries=[...]>`. After the
// mass substring migration those imports now read from
// `@tanstack/react-router` — which does NOT export `MemoryRouter`.
//
// Rather than rewriting each test file's wrapper, this file exposes a
// `MemoryRouter` component that uses TanStack Router's
// `createMemoryHistory + createRouter + RouterProvider` plumbing under
// the hood. The public surface (`children`, `initialEntries`,
// `initialPath`, `initialIndex`) mirrors react-router-dom v6 closely
// enough that the existing test code continues to type-check and run
// without modification.
//
// Why we keep `initialPath` as an alternative even though RR v6 didn't:
// legacy `TestProviders.tsx` (separate wrapper in this directory)
// already accepted `initialPath`. Some tests pass `initialPath` rather
// than `initialEntries`. Accepting both keeps us drop-in compatible.
//
// The routeTree is the live `app/routeTree.gen.ts` so component tests
// get a real router context — `useNavigate`, `useLocation`, `<Link>`,
// `<Outlet>`, etc. all work without per-test `vi.mock('@tanstack/
// react-router', ...)` boilerplate.
// ──────────────────────────────────────────────────────────────────────────

import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  createMemoryHistory,
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'

export interface MemoryRouterProps {
  children: ReactNode
  /**
   * Initial history entries. Mirrors react-router-dom v6's
   * `MemoryRouter.initialEntries`. Default: `['/']`.
   */
  initialEntries?: string[]
  /**
   * Legacy alias for `initialEntries` with a single path. Default: `undefined`.
   * If BOTH `initialEntries` and `initialPath` are passed, `initialEntries`
   * wins and `initialPath` is ignored.
   */
  initialPath?: string
  /** Initial history index (react-router-dom v6 compat). Default: 0. */
  initialIndex?: number
}

export function MemoryRouter({
  children,
  initialEntries,
  initialPath,
  initialIndex = 0,
}: MemoryRouterProps) {
  // Memo-key on the joined entries string so changes to `initialEntries`
  // (e.g. across test cases via path swap) produce a fresh router
  // instance; navigation-only changes do not.
  const entriesSignature = initialEntries?.join('|')

  // ── children ref pattern ───────────────────────────────────────────
  // `children` is a fresh JSX element on every render of the test
  // wrapper (e.g. `<AppShell />` is constructed anew whenever the
  // parent re-renders). Including it in `useMemo` deps would force
  // `createRouter` to rebuild the entire router (and unmount/
  // remount RouterProvider) on every render — leaving the router
  // perpetually in a pending state and the test DOM empty
  // (`<body><div /></body>`).
  //
  // We side-step this by holding `children` in a mutable ref and
  // reading it from the router's leaf component closure. The router
  // itself only rebuilds when `initialEntries` / `initialPath` /
  // `initialIndex` change (i.e. when the test's URL target moves).
  const childrenRef = useRef<ReactNode>(children)
  childrenRef.current = children

  const router = useMemo(
    () => {
      // rootRoute → Outlet so the matched descendant route renders
      // through it. The ACTUAL page content lives in the catchAll
      // component below. This layout (root renders Outlet, catchAll
      // renders children) is what guarantees TanStack Router hooks
      // like `useParams` / `useSearch` / `<Link>` resolve correctly
      // inside the children — without Outlet on the root, the
      // children render outside the matched-route context and any
      // router hook inside them throws.
      const rootRoute = createRootRoute({ component: Outlet })
      // Catch-all so ANY initial path (`/dashboard/inbox`, `/login`,
      // `/`, etc.) matches without per-test route registration —
      // mirroring react-router-dom's MemoryRouter which doesn't
      // require paths to be pre-declared. Component closure reads
      // childrenRef.current so the latest children renders without
      // rebuilding the router (children is in a ref, NOT a useMemo
      // dep — see the useRef rationale above).
      const catchAllRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '$',
        component: () => <>{childrenRef.current}</>,
      })
      rootRoute.addChildren([catchAllRoute])
      return createRouter({
        routeTree: rootRoute,
        history: createMemoryHistory({
          initialEntries: initialEntries ?? (initialPath ? [initialPath] : ['/']),
          initialIndex,
        }),
      })
    },
    // `entriesSignature` already captures array contents; `initialPath`
    // only matters when `initialEntries` is null. We keep it as a dep
    // so passing `initialPath` alone still works. **Do NOT add
    // `children` here** — see the useRef rationale above.
    [entriesSignature, initialPath, initialIndex],
  )
  return <RouterProvider router={router} />
}
