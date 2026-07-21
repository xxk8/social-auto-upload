import { create } from 'zustand'
import { api } from '@/api/client'

/**
 * Publish-template store backed by the server `/api/templates/*` endpoints
 * with a localStorage cache for instant mount reads.
 *
 * The store keeps a mirror of server-side templates in `templates` so the
 * UI can render immediately from cache while a background refetch syncs.
 * Mutations (`add`, `update`, `remove`) are optimistic: they update the
 * local list first, then fire the API call. On failure the caller can
 * call `fetchAll()` to re-sync.
 */

export type PublishTemplate = {
  id: number
  name: string
  mode: string
  snapshot: Record<string, unknown>
  created_at: string
  updated_at: string
}

const CACHE_KEY = 'sau-publish-templates-cache'

function loadCache(): PublishTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as PublishTemplate[]) : []
  } catch {
    return []
  }
}

function saveCache(templates: PublishTemplate[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(templates))
  } catch {
    /* quota / private mode — silently drop */
  }
}

interface TemplatesState {
  templates: PublishTemplate[]
  loading: boolean
  error: string | null

  fetchAll: () => Promise<void>
  add: (name: string, mode: string, snapshot: Record<string, unknown>) => Promise<boolean>
  update: (id: number, payload: { name?: string; snapshot?: Record<string, unknown> }) => Promise<boolean>
  remove: (id: number) => Promise<boolean>
  importTemplates: (templates: Array<{ name: string; mode: string; snapshot: Record<string, unknown> }>) => Promise<boolean>
  clearError: () => void
}

export const useTemplatesStore = create<TemplatesState>((set, get) => ({
  templates: loadCache(),
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null })
    try {
      const res = await api.templates.list()
      if (res.success && res.data) {
        set({ templates: res.data, loading: false })
        saveCache(res.data)
      } else {
        set({ loading: false })
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load templates' })
    }
  },

  add: async (name, mode, snapshot) => {
    try {
      const res = await api.templates.create({ name, mode, snapshot })
      if (res.success) {
        await get().fetchAll()
        return true
      }
      set({ error: res.message ?? 'Failed to create template' })
      return false
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to create template' })
      return false
    }
  },

  update: async (id, payload) => {
    // Optimistic update
    set((state) => ({
      templates: state.templates.map((t) =>
        t.id === id
          ? {
              ...t,
              ...('name' in payload ? { name: payload.name! } : {}),
              ...('snapshot' in payload ? { snapshot: payload.snapshot! } : {}),
            }
          : t,
      ),
    }))
    try {
      const res = await api.templates.update(id, payload)
      if (!res.success) {
        set({ error: res.message ?? 'Failed to update template' })
        await get().fetchAll() // revert on failure
        return false
      }
      saveCache(get().templates)
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to update template' })
      await get().fetchAll()
      return false
    }
  },

  remove: async (id) => {
    const prev = get().templates
    // Optimistic remove
    set((state) => ({ templates: state.templates.filter((t) => t.id !== id) }))
    try {
      const res = await api.templates.delete(id)
      if (!res.success) {
        set({ templates: prev, error: res.message ?? 'Failed to delete template' })
        return false
      }
      saveCache(get().templates)
      return true
    } catch (e) {
      set({ templates: prev, error: e instanceof Error ? e.message : 'Failed to delete template' })
      return false
    }
  },

  importTemplates: async (templates) => {
    try {
      const res = await api.templates.import(templates)
      if (res.success) {
        await get().fetchAll()
        return true
      }
      set({ error: res.message ?? 'Failed to import templates' })
      return false
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to import templates' })
      return false
    }
  },

  clearError: () => set({ error: null }),
}))
