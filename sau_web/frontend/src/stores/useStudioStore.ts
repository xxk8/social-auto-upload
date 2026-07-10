import { create } from 'zustand'
import type { StudioProject } from '@/api/studio'

/**
 * Studio (Script Studio) global store.
 *
 * Phase 1 ships the API surface (projects + currentProjectId) but
 * StudioPage reads the project list through TanStack Query. The
 * store's `setProjects` action is invoked from a query-driven
 * effect so other panels (AppShell sidebar counting, command
 * palette search) see a synchronous snapshot. Phase 2 (v0.2) will
 * extend this with per-episode selection + streaming progress
 * slices — keeping the surface narrow in v0.1 lets the migration
 * be additive.
 */
export interface StudioState {
  /** Authoritative cached list, syncing from TanStack Query on success. */
  projects: StudioProject[]
  /** Selected project for detail navigation (Phase 2 onwards). */
  currentProjectId: number | null

  setProjects: (projects: StudioProject[]) => void
  setCurrentProjectId: (id: number | null) => void
  reset: () => void
}

const INITIAL: Pick<StudioState, 'projects' | 'currentProjectId'> = {
  projects: [],
  currentProjectId: null,
}

export const useStudioStore = create<StudioState>((set) => ({
  ...INITIAL,

  setProjects: (projects) => set({ projects }),
  setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),

  reset: () => set(INITIAL),
}))
