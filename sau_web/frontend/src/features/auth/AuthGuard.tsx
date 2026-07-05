import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          <span className="text-sm text-muted-foreground">验证登录状态…</span>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
