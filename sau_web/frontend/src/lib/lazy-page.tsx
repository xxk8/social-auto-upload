/**
 * Route-level code-split helper for TanStack file routes.
 *
 * Vite still static-imports every `app/routes/*.tsx`. Wrapping the page
 * itself in `React.lazy` pushes the heavy page modules (Landing + GSAP,
 * Analytics + recharts, Calendar, Studio, …) into separate chunks that
 * only download when the route is first visited.
 */
import { lazy, type ComponentType } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage(loader: () => Promise<{ default: ComponentType<any> }>) {
  const Comp = lazy(loader)
  return function LazyRoutePage() {
    return <Comp />
  }
}
