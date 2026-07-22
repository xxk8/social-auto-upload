/**
 * Local Web Shell mode — this repo's Python Flask backend is a
 * single-operator CLI shell (accounts / upload / tasks / logs / AI).
 * It does NOT implement multi-user `/api/auth/*`.
 *
 * Default ON. Set `VITE_SAU_LOCAL_SHELL=0` only if you wire a real
 * auth backend and want AuthGuard + JWT session behaviour.
 */
import type { AuthUser } from './authApi'

export function isLocalShellMode(): boolean {
  const raw = import.meta.env.VITE_SAU_LOCAL_SHELL
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  return true
}

/** Synthetic operator used when Flask has no `/api/auth/me`. */
export const LOCAL_SHELL_USER: AuthUser = {
  id: 0,
  email: 'local@sau.local',
  role: 'admin',
  name: '本地操作员',
  tier: 'local',
  is_founder: true,
  has_password: false,
}

export function isLocalShellUser(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.email === LOCAL_SHELL_USER.email)
}
