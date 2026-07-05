import { create } from 'zustand'
import type { GroupSelection } from '../features/publish/GroupPublishSelector'
import { normalizeTag, parseTags } from '../lib/tags'

export type WizardStep = 0 | 1 | 2 // Upload → Content → Review
export type WizardMode = 'video' | 'note'

/** Files collected in step 1 (Upload). `File` objects live in memory only;
 *  snapshots persisted to draft store use the plain metadata shape from
 *  `usePublishDraft`'s `isPlainMetadataObject`. */
export type WizardFile = {
  /** Main media file (video or first image) */
  file: File | null
  /** Additional image files for note mode */
  images: File[]
  /** Thumbnail file (optional, video only) */
  thumbnail: File | null
  /** Thumbnail orientation variant (optional) */
  thumbnailPortrait: File | null
  thumbnailLandscape: File | null
}

export type WizardContent = {
  title: string
  desc: string
  /**
   * Path C: native `string[]` representation. The canonical `#tag`
   * shape means `'foo'` and `'#foo'` collapse to the same normalized
   * entry — helpers treat them as interchangeable. The wire-form
   * string (`.join(',')`) only exists at the HTTP boundary, which
   * `ReviewStep::handleSubmit` constructs via
   * `lib/tags::serializeTags` at the api call site.
   *
   * Subscribers may use `usePublishWizardStore((s) => s.content.tags)`
   * directly — Zustand's strict-equality check guarantees no
   * re-renders on Title / Notes / Schedule keystrokes; only mutators
   * (`addTag / removeTag / toggleTag / setTags`) change the reference.
   */
  tags: string[]
  note: string
  schedule: string
  /** Platform-specific advanced fields snapshot */
  advanced: Record<string, unknown>
}

interface PublishWizardState {
  /** Current wizard step (0 = upload, 1 = content, 2 = review) */
  currentStep: WizardStep
  /** Content type */
  mode: WizardMode
  /** Files from step 1 */
  files: WizardFile
  /** Content fields from step 2 */
  content: WizardContent
  /** Selected account group + platforms (required for all steps) */
  groupSelection: GroupSelection | null

  // Navigation
  setStep: (step: WizardStep) => void
  nextStep: () => void
  prevStep: () => void
  /** Returns true if the current step's required fields are filled. */
  canProceed: () => boolean
  /**
   * Symbolic reason the wizard is blocked from advancing — null when
   * ready. WizardNav surfaces this as the disabled button's
   * `title` tooltip so users see *why* 「下一步」 is muted instead
   * of guessing. Mirrors canProceed()'s branching so the two stay in
   * lock-step.
   */
  proceedReason: () => string | null
  reset: () => void

  // Mode + files
  setMode: (mode: WizardMode) => void
  setFiles: (files: Partial<WizardFile>) => void
  clearFiles: () => void

  // Group
  setGroupSelection: (selection: GroupSelection | null) => void

  // Content — `setContent({ tags })` accepts BOTH `string[]` (canonical
  // post-Path-C) AND `string` (legacy wire form) for backward compat
  // with AI chat / variant-apply write sites. `parseTags` from
  // `@/lib/tags` normalizes both through one boundary.
  setContent: (content: Partial<WizardContent>) => void
  clearContent: () => void

  /**
   * **Removed in Path C**: the `tagsArray()` selector was deleted
   * because it returned a fresh array reference on every call,
   * breaking React.memo on every Title/Notes keypress. Callers now
   * subscribe via `usePublishWizardStore((s) => s.content.tags)`
   * which is reference-stable across unrelated field changes.
   *
   * The named mutation helpers stay — they keep membership logic
   * (canonical-hash collapse, no-op on empty) in one place so
   * callers don't re-implement the dedupe rules.
   */
  addTag: (raw: string) => void
  removeTag: (raw: string) => void
  toggleTag: (raw: string) => void
  setTags: (tags: string[]) => void
}

const EMPTY_FILES: WizardFile = {
  file: null,
  images: [],
  thumbnail: null,
  thumbnailPortrait: null,
  thumbnailLandscape: null,
}

const EMPTY_CONTENT: WizardContent = {
  title: '',
  desc: '',
  tags: [],
  note: '',
  schedule: '',
  advanced: {},
}

const MAX_STEP: WizardStep = 2

export const usePublishWizardStore = create<PublishWizardState>((set, get) => ({
  currentStep: 0,
  mode: 'video',
  files: { ...EMPTY_FILES },
  content: { ...EMPTY_CONTENT },
  groupSelection: null,

  setStep: (step) => set({ currentStep: step }),
  nextStep: () => {
    const { currentStep, canProceed } = get()
    if (canProceed() && currentStep < MAX_STEP) {
      set({ currentStep: (currentStep + 1) as WizardStep })
    }
  },
  prevStep: () => {
    const { currentStep } = get()
    if (currentStep > 0) {
      set({ currentStep: (currentStep - 1) as WizardStep })
    }
  },
  /**
   * Per-step validation gate. Called by `nextStep()` and `WizardNav`.
   *
   *   Step 0 (Upload): a main file (video) or at least one image (note) is required.
   *   Step 1 (Content): title is non-empty.
   *   Step 2 (Review): always true — the submit button is the final action.
   */
  canProceed: () => {
    const { currentStep, mode, files, content, groupSelection } = get()
    const hasGroup = groupSelection !== null && groupSelection.platforms.length > 0
    if (!hasGroup) return false
    if (currentStep === 0) {
      return mode === 'video' ? files.file !== null : files.images.length > 0
    }
    if (currentStep === 1) {
      return content.title.trim().length > 0
    }
    return true
  },
  proceedReason: () => {
    const { currentStep, mode, files, content, groupSelection } = get()
    if (groupSelection === null) return '请先在上方选择发布账号组'
    if (groupSelection.platforms.length === 0) return '请至少勾选一个发布平台'
    if (currentStep === 0) {
      if (mode === 'video' && files.file === null) return '请上传视频文件'
      if (mode === 'note' && files.images.length === 0) return '请至少添加一张图片'
    }
    if (currentStep === 1) {
      if (!content.title.trim()) return '请填写标题'
    }
    return null
  },
  reset: () =>
    set({
      currentStep: 0,
      mode: 'video',
      files: { ...EMPTY_FILES },
      content: { ...EMPTY_CONTENT },
      groupSelection: null,
    }),

  setMode: (mode) => set({ mode, files: { ...EMPTY_FILES } }),
  setFiles: (partial) => set((state) => ({ files: { ...state.files, ...partial } })),
  clearFiles: () => set({ files: { ...EMPTY_FILES } }),
  setGroupSelection: (selection) => set({ groupSelection: selection }),

  // `setContent({ tags })` accepts BOTH string[] (canonical) and
  // string (legacy wire form) for backward compat with chat / variant
  // write sites. `parseTags` is the single normalization boundary
  // — adding a 3rd representation later only touches `lib/tags.ts`.
  setContent: (partial) =>
    set((state) => {
      let tags: string[] | undefined
      if (partial.tags !== undefined) {
        tags = parseTags(partial.tags)
      }
      return {
        content: {
          ...state.content,
          ...partial,
          ...(tags !== undefined ? { tags } : {}),
        },
      }
    }),
  clearContent: () => set({ content: { ...EMPTY_CONTENT } }),

  // ── Tag array helpers (post-Path-C) ─────────────────────────────────
  // Each operates on `content.tags` (string[]) directly. Membership
  // semantics live behind the helpers so consumers do not re-implement
  // the canonical-hash collapse + dedupe rules. Reference identity on
  // `content.tags` is preserved when the helpers don't change the set
  // (e.g. adding an already-present tag is a no-op — same array
  // reference returned), keeping subscriber memoization intact.
  addTag: (raw: string) => {
    const target = normalizeTag(raw)
    if (!target) return
    const current = get().content.tags
    if (current.includes(target)) return
    set((state) => ({ content: { ...state.content, tags: [...current, target] } }))
  },

  removeTag: (raw: string) => {
    const target = normalizeTag(raw)
    if (!target) return
    const current = get().content.tags
    if (!current.includes(target)) return
    set((state) => ({ content: { ...state.content, tags: current.filter((t) => t !== target) } }))
  },

  toggleTag: (raw: string) => {
    const target = normalizeTag(raw)
    if (!target) return
    const current = get().content.tags
    const next = current.includes(target)
      ? current.filter((t) => t !== target)
      : [...current, target]
    set((state) => ({ content: { ...state.content, tags: next } }))
  },

  // Direct array write — used by AI bridge calls and bulk operations.
  // Re-normalizes and de-dupes on entry to keep the canonical shape.
  // No-op when the normalized array equals the current reference (cheap
  // shallow-array compare via `.join(',')`); preserves reference
  // identity for unchanged input.
  setTags: (tags: string[]) => {
    const normalized = parseTags(tags)
    const current = get().content.tags
    // Cheap identity check: same length + same entries means same
    // normalized array (parseTags is dedupe-strict). The join() round-
    // trip serves as the fast equality key without allocating a Set.
    if (
      normalized.length === current.length &&
      normalized.join('|') === current.join('|')
    ) {
      return
    }
    set((state) => ({ content: { ...state.content, tags: normalized } }))
  },
}))
