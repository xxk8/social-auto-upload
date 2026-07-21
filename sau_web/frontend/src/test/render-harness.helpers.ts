import { QueryClient } from '@tanstack/react-query'

/**
 * Per-test query client. Defaults to disabled retries + minimal cache
 * TTL so tests don't accidentally cross-pollute between assertions.
 *
 * Lives in this .ts helper file (not in render-harness.tsx) so the
 * .tsx file can keep `only-export-components` inviolate: every top-level
 * export of render-harness.tsx is a React component. This is the same
 * split pattern as the badge.tsx + button.tsx cva recipe refactors —
 * callable helpers are conceptual metadata, not components.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
        refetchOnWindowFocus: false,
      },
    },
  })
}

/**
 * Counter for React.Profiler onRender callbacks. Tests use this to
 * detect memo hits: re-rendering the same tree with shallow-equal
 * props must NOT trigger a fresh onRender for that subtree (React.memo
 * short-circuits before Profiler fires).
 */
export type ProfilerCounter = {
  /** Push of `phase` ('mount' | 'update' | 'nested-update') for each commit */
  phases: string[]
  reset: () => void
}

export function makeProfilerCounter(): ProfilerCounter {
  const phases: string[] = []
  return {
    phases,
    reset: () => {
      phases.length = 0
    },
  }
}
