import type { ReactNode } from 'react'
import { Navigate } from '@tanstack/react-router'
import { useAuth } from './useAuth'
import { AuthLoadingSkeleton } from './AuthLoadingSkeleton'
import { isLocalShellMode } from './localShell'

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()

  // Local CLI Web Shell: no multi-user session. Platform cookies live
  // on disk; do not bounce operators to /login for missing /api/auth/me.
  if (isLocalShellMode()) {
    return <>{children}</>
  }

  // Round-OPT-3J: during the initial /api/auth/me resolution the
  // user previously saw a centered spinner with "验证登录状态…".
  // Round-OPT-3J follow-up: a fully-blank content area felt too
  // abrupt, so we now render a lightweight `AuthLoadingSkeleton`
  // (generic PageHeader + 3 content blocks) instead of `null`.
  // The skeleton is shared with route-level <Suspense> fallbacks
  // (see AuthLoadingSkeleton.tsx JSDoc) so the auth window and
  // the chunk-load window paint the same sketched content area.
  // AppShell still paints its chrome (sidebar / header) outside
  // the guard, so the operator sees the familiar shell with a
  // sketched content area until the auth query resolves. Once it
  // does, we either bounce anonymous visitors to /login or
  // commit `children` for authed operators. The isLoading gate
  // MUST stay BEFORE the !isAuthenticated check so a freshly-
  // hydrated authed user (initial store: isLoading=true,
  // isAuthenticated=false) doesn't flash to /login before the
  // /me query lands.
  if (isLoading) {
    return <AuthLoadingSkeleton />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
