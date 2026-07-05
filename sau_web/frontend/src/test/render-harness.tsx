// ONLY React components in this file. Callable helpers live in
// `./render-harness.helpers.ts`; this is the same split pattern as
// `button.tsx` (module-local `buttonVariants`) and `badge.tsx` —
// callable artifacts are conceptual metadata, not components, and
// must NOT be co-exported with components from a `.tsx` file.
import { Profiler, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import { type ProfilerCounter } from './render-harness.helpers'
import { ThemeProvider } from '@/Components/ThemeProvider'
import { ToastProvider } from '@/Components/ui/toast'

// A lightweight "no-op" provider for global context that many components
// depend on. Tests that need specific setup (e.g. custom initialEntries)
// can still wrap in their own providers on top of <TestProviders>.
//
// Includes:
//   - QueryClientProvider     (TanStack Query — required by most hooks)
//   - MemoryRouter            (react-router — for useNavigate / useLocation)
//   - ThemeProvider           (dark/light mode context)
//   - ToastProvider           (toast notifications)
//   - ProfilerWrap            (optional — for render-count assertions)

export function ProfilerWrap({
  id,
  counter,
  children,
}: {
  id: string
  counter?: ProfilerCounter
  children: ReactNode
}) {
  return (
    <Profiler
      id={id}
      onRender={(_id, _phase, ..._rest) => {
        // `_rest` carries Profiler-onRender's `actualDuration`,
        // `baseDuration`, `startTime`, `commitTime` — not consumed by
        // memo-hit-rate assertions. `argsIgnorePattern: "^_"` in
        // eslint.config.js keeps this clean (no per-line disable).
        counter?.phases.push(_phase as string)
      }}
    >
      {children}
    </Profiler>
  )
}

/**
 * Standard harness used by every form/drawer test. Provides QueryClient;
 * tests wrap with <ProfilerWrap> themselves so they control the id.
 *
 * Wraps in <MemoryRouter> so `useNavigate()` / `useLocation()` / `useParams()`
 * called inside the component-under-test don't throw. Tests that need a
 * specific URL can pass `initialEntries={['/somewhere']}` via the optional
 * prop. Tests that explicitly `vi.mock('react-router-dom', ...)` continue
 * to override the live router with their spy.
 */
export function TestProviders({
  client,
  initialEntries,
  children,
}: {
  client: QueryClient
  initialEntries?: string[]
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <ThemeProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}
