import { create } from 'zustand'
import { api } from '@/api/client'

/**
 * License / tier store. Tracks the current user's tier, active key, and
 * exposes activate / deactivate actions that call the backend
 * `/api/license/*` endpoints.
 *
 * The store is intentionally NOT persisted to localStorage — the tier
 * and key status are authoritative server-side and should be re-fetched
 * on every page load to avoid a stale-tier privilege escalation.
 */

export type LicenseTier = 'free' | 'pro' | 'legacy'

interface LicenseState {
  tier: LicenseTier
  /** Active license key (masked, e.g. "SAU-pro-••••") or null */
  key: string | null
  /** ISO timestamp of activation, or null */
  activatedAt: string | null
  loading: boolean
  error: string | null

  fetchStatus: () => Promise<void>
  activate: (key: string) => Promise<boolean>
  deactivate: () => Promise<boolean>
  clearError: () => void
}

export const useLicenseStore = create<LicenseState>((set) => ({
  tier: 'legacy',
  key: null,
  activatedAt: null,
  loading: false,
  error: null,

  fetchStatus: async () => {
    set({ loading: true, error: null })
    try {
      const res = await api.license.status()
      if (res.success && res.data) {
        set({
          tier: (res.data.tier as LicenseTier) ?? 'legacy',
          key: res.data.key,
          activatedAt: res.data.activated_at,
          loading: false,
        })
      } else {
        set({ loading: false })
      }
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to fetch license status',
      })
    }
  },

  activate: async (key) => {
    set({ loading: true, error: null })
    try {
      const res = await api.license.activate(key)
      if (res.success && res.data) {
        set({
          tier: (res.data.tier as LicenseTier) ?? 'legacy',
          activatedAt: res.data.activated_at,
          key,
          loading: false,
        })
        return true
      }
      set({ loading: false, error: res.message ?? 'Invalid license key' })
      return false
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to activate license',
      })
      return false
    }
  },

  deactivate: async () => {
    set({ loading: true, error: null })
    try {
      const res = await api.license.deactivate()
      if (res.success && res.data) {
        set({
          tier: (res.data.tier as LicenseTier) ?? 'legacy',
          key: null,
          activatedAt: null,
          loading: false,
        })
        return true
      }
      set({ loading: false, error: 'Failed to deactivate license' })
      return false
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to deactivate license',
      })
      return false
    }
  },

  clearError: () => set({ error: null }),
}))
