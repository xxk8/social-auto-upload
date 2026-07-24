/**
 * react-router-dom compatible useSearchParams for TanStack Router migration.
 * Returns [URLSearchParams, setSearchParams] like RRDv6.
 */
import { useCallback, useMemo } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'

type SetSearchParams = (
  next: URLSearchParams | Record<string, string> | ((prev: URLSearchParams) => URLSearchParams | Record<string, string>),
  navigateOpts?: { replace?: boolean },
) => void

export function useSearchParams(): [URLSearchParams, SetSearchParams] {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  const navigate = useNavigate()

  const params = useMemo(() => {
    const raw = searchStr.startsWith('?') ? searchStr.slice(1) : searchStr
    return new URLSearchParams(raw)
  }, [searchStr])

  const setSearchParams = useCallback<SetSearchParams>(
    (next, navigateOpts) => {
      const current = new URLSearchParams(
        searchStr.startsWith('?') ? searchStr.slice(1) : searchStr,
      )
      let resolved: URLSearchParams | Record<string, string>
      if (typeof next === 'function') {
        resolved = next(new URLSearchParams(current))
      } else {
        resolved = next
      }
      const sp =
        resolved instanceof URLSearchParams
          ? resolved
          : new URLSearchParams(resolved as Record<string, string>)
      const qs = sp.toString()
      void navigate({
        to: '.',
        search: Object.fromEntries(sp.entries()) as Record<string, unknown>,
        replace: navigateOpts?.replace,
        // fallback: some routes may not accept free search — still update hash path via href
        ...(qs ? {} : {}),
      } as never)
      // Also push via history when route search schema rejects unknown keys
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.search = qs ? `?${qs}` : ''
        if (navigateOpts?.replace) {
          window.history.replaceState(window.history.state, '', url.toString())
        } else {
          window.history.pushState(window.history.state, '', url.toString())
        }
      }
    },
    [navigate, searchStr],
  )

  return [params, setSearchParams]
}

export default useSearchParams
