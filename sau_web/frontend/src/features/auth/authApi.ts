import { request } from '@/api/client'

// ── Round 7: profile contract extension. `name` + `avatar` are
// PATCH-mutable via /api/auth/me; `tier` is always returned (read-
// only — admin-only mutation goes through /api/auth/license/activate).
// All four are optional on the wire because legacy callers / tests
// may still drive `setAuth({ user: { id, email, role } })` without
// the new fields. The router handles nulls cleanly: ProfilePage 显示名
// row falls back to '—' when name is null, UserMenu falls back to
// email[0].toUpperCase() when avatar is null.
//
// `is_founder` (round ai-api-keys-founder): single-source-of-truth
// flag for AI-keys-management privilege, strictly narrower than
// `role='admin'`. The AiSettingsPopover gates its add/batch/list/
// delete UI on this field; the admin dashboard's Founder-transfer
// action only fires when it's true. Backend always emits the key
// (even when false) so a `?? false` consumer never trips on
// `undefined`.
export type AuthUser = {
  id: number
  email: string
  role: 'admin' | 'user'
  name?: string | null
  avatar?: string | null
  tier?: string
  created_at?: string
  last_login?: string
  is_founder?: boolean
  has_password?: boolean
}

// Wire payload for PATCH /api/auth/me. Both fields optional; supply
// either, both, or neither. Passing `null` (or empty string) CLEARS
// the column back to NULL — not a no-op.
export type UpdateMePayload = {
  name?: string | null
  avatar?: string | null
}

export const authApi = {
  sendCode(email: string): Promise<{ success: boolean; message?: string }> {
    return request.post('/api/auth/send-code', { email }).then((r) => r.data)
  },

  login(email: string, code: string): Promise<{ success: boolean; data?: { user: AuthUser }; message?: string }> {
    return request.post('/api/auth/login', { email, code }).then((r) => r.data)
  },

  logout(): Promise<{ success: boolean; message?: string }> {
    return request.post('/api/auth/logout').then((r) => r.data)
  },

  getMe(): Promise<{ success: boolean; data?: { user: AuthUser }; message?: string }> {
    return request.get('/api/auth/me').then((r) => r.data)
  },

  // Partial-update the authed user's profile. Returns the full
  // updated user (same shape as getMe) so useAuth's
  // invalidateQueries flow sees a populated cache on next read.
  // 422 → validation failure (name length / avatar scheme /
  // privilege-escalation fields rejected); 401 → unauthenticated.
  updateMe(payload: UpdateMePayload): Promise<{ success: boolean; data?: { user: AuthUser }; message?: string }> {
    return request.patch('/api/auth/me', payload).then((r) => r.data)
  },

  getUsers(): Promise<{ success: boolean; data?: AuthUser[]; message?: string }> {
    return request.get('/api/auth/users').then((r) => r.data)
  },

  updateUserRole(userId: number, role: string): Promise<{ success: boolean; message?: string }> {
    return request.put(`/api/auth/users/${userId}/role`, { role }).then((r) => r.data)
  },

  getSseToken(): Promise<{ success: boolean; data?: { token: string; expires_in: number }; message?: string }> {
    return request.get('/api/auth/sse-token').then((r) => r.data)
  },

  // ── Social login (round OPT-admin-social) ──
  googleLogin(): void {
    window.location.href = '/api/auth/google/login'
  },

  githubLogin(): void {
    window.location.href = '/api/auth/github/login'
  },

  // ── Password authentication ──
  loginByPassword(email: string, password: string): Promise<{ success: boolean; data?: { user: AuthUser }; message?: string }> {
    return request.post('/api/auth/login-by-password', { email, password }).then((r) => r.data)
  },

  setPassword(password: string): Promise<{ success: boolean; message?: string }> {
    return request.post('/api/auth/set-password', { password }).then((r) => r.data)
  },

  changePassword(oldPassword: string, newPassword: string): Promise<{ success: boolean; message?: string }> {
    return request.post('/api/auth/change-password', { old_password: oldPassword, new_password: newPassword }).then((r) => r.data)
  },

  forgotPassword(email: string): Promise<{ success: boolean; message?: string }> {
    return request.post('/api/auth/forgot-password', { email }).then((r) => r.data)
  },

  resetPassword(email: string, code: string, newPassword: string): Promise<{ success: boolean; message?: string }> {
    return request.post('/api/auth/reset-password', { email, code, new_password: newPassword }).then((r) => r.data)
  },
}
