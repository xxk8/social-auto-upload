import { create } from 'zustand'
import type { AuthUser } from './authApi'

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  setUser: (user: AuthUser) => void
  clearAuth: () => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // start true until first getMe completes

  setUser: (user) => set({ user, isAuthenticated: true, isLoading: false }),

  clearAuth: () => set({ user: null, isAuthenticated: false, isLoading: false }),

  setLoading: (isLoading) => set({ isLoading }),
}))
