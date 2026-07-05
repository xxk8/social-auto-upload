// Types live here so `login-render-helper.ts` (the function) can stay a
// single-export .ts file. Pair with that file's pure-name import, e.g.
//   import { mountLoginPage } from './login-render-helper'
//   import type { MountLoginPageOptions, MountedLoginPage } from './login-render-helper.types'
//
// `.ts` (not `.tsx`) is intentional: a file with interfaces + types only
// has zero JSX, so react-refresh/only-export-components does not fire
// here. Replacing this split with a single .tsx would re-trigger the
// lint violation our SPLIT was designed to eliminate.

import type { mockNavigate } from './auth-router-spies'

export interface MountLoginPageOptions {
  isAuthenticated?: boolean
  isLoading?: boolean
  user?: { id: number; email: string; role: 'admin' | 'user' } | null
  sendCode?: (email: string) => Promise<{ success: boolean; message?: string }>
  login?: (
    email: string,
    code: string,
  ) => Promise<{ success: boolean; data?: unknown; message?: string }>
  logout?: () => Promise<{ success: boolean; message?: string }>
  sendCodeStatus?: 'idle' | 'pending' | 'success' | 'error'
  loginStatus?: 'idle' | 'pending' | 'success' | 'error'
}

export interface MountedLoginPage {
  /** The vi.fn spy for `useNavigate`. Assert against this directly. */
  navigateSpy: typeof mockNavigate
  /** Type an email and click 发送验证码, awaiting microtask flush. */
  clickEmailSubmit(email: string): Promise<void>
  /** Type a 6-digit code and click 登录, awaiting microtask flush. */
  clickCodeSubmit(code: string): Promise<void>
}
