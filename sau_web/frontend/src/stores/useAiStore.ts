import { create } from 'zustand'

interface AiState {
  selectedModel: string
  modelTags: string[]
  isGenerating: boolean
  queuePosition: number
  error: string | null
  /** Pending image data-URLs for the next chat turn (ChatGPT-style attach). */
  composerImages: string[]
  /** Active skill id loaded via /skill (shown on composer footer). */
  activeSkillId: string | null

  setSelectedModel: (model: string) => void
  setModelTags: (tags: string[]) => void
  setIsGenerating: (val: boolean) => void
  setQueuePosition: (pos: number) => void
  setError: (err: string | null) => void
  addComposerImage: (dataUrl: string) => void
  removeComposerImage: (index: number) => void
  clearComposerImages: () => void
  setActiveSkillId: (id: string | null) => void
  reset: () => void
}

const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free'
const MAX_COMPOSER_IMAGES = 4

export const useAiStore = create<AiState>((set) => ({
  selectedModel: DEFAULT_MODEL,
  modelTags: ['text'],
  isGenerating: false,
  queuePosition: 0,
  error: null,
  composerImages: [],
  activeSkillId: null,

  setSelectedModel: (model) => set({ selectedModel: model }),
  setModelTags: (tags) => set({ modelTags: tags }),
  setIsGenerating: (val) => set({ isGenerating: val }),
  setQueuePosition: (pos) => set({ queuePosition: pos }),
  setError: (err) => set({ error: err }),
  addComposerImage: (dataUrl) =>
    set((s) =>
      s.composerImages.length >= MAX_COMPOSER_IMAGES
        ? s
        : { composerImages: [...s.composerImages, dataUrl] },
    ),
  removeComposerImage: (index) =>
    set((s) => ({
      composerImages: s.composerImages.filter((_, i) => i !== index),
    })),
  clearComposerImages: () => set({ composerImages: [] }),
  setActiveSkillId: (id) => set({ activeSkillId: id }),
  reset: () =>
    set({
      isGenerating: false,
      queuePosition: 0,
      error: null,
      composerImages: [],
      activeSkillId: null,
    }),
}))
