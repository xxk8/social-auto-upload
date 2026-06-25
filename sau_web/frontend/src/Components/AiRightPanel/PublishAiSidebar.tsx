import { useState } from 'react'
import type { RefObject } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Loader2,
  Sparkles,
  ChevronRight,
  Eye,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { Badge } from '@/Components/ui/badge'
import { Button } from '@/Components/ui/button'
import { cn } from '@/lib/utils'
import { AiSidebar, type AiGenerationResult } from '@/Components/AiSidebar/AiSidebar'
import { PublishPreview, type FormPreviewData } from '@/features/publish/PublishPreview'
import { useAiStore } from '@/stores/useAiStore'
import { useAiConfig } from '@/hooks/useAiConfig'
import type { FormHandle } from '@/lib/chat/chatFormBridge'

interface PublishAiSidebarProps {
  mode: 'video' | 'note'
  platform?: string
  onGenerated: (result: AiGenerationResult) => void
  /** Form mode used by the inline preview at the bottom of the panel. */
  previewMode: 'video' | 'note'
  /** Live form data, fed from VideoForm / NoteForm via `onFormChange`. */
  previewData: FormPreviewData
  /**
   * Imperative ref of the currently-active publish form. The chat
   * pipeline reads this at send time (snapshot) and at apply time
   * (result write-back). The same handle contract is implemented by
   * both VideoForm and NoteForm via `useImperativeHandle`.
   */
  formRef: RefObject<FormHandle | null>
  /**
   * OPT-3F: rail-vs-full-panel state. Defaults to `false` (full panel).
   * When `true`, the side widget renders a 60px-wide vertical rail with
   * the Sparkles affordance + an expand button, mirroring the main
   * AppShell sidebar's collapsed-rail pattern.
   *
   * The mobile-drawer call site deliberately omits this prop so the
   * drawer always renders the full panel — the rail design is desktop-only.
   */
  collapsed?: boolean
  /**
   * OPT-3F: handler to flip the `collapsed` state. Required by
   * <PublishAiSidebar/> when `collapsed` is `true` (rail needs the
   * "open" handler). Optional in the full-panel branch (the close
   * button sits in the panel header; omitting the prop there hides
   * the close button if a future caller mistakenly wires both branches
   * into the same contract).
   */
  onToggleCollapsed?: () => void
}

// Compact model-name display: take last segment after `/` and cap length.
function shortModel(id: string): string {
  const tail = id.split('/').pop() || id
  return tail.length > 22 ? `${tail.slice(0, 20)}…` : tail
}

/**
 * Right-side AI assistant panel for the publish page.
 *
 * Two layout shapes (OPT-3F):
 *
 *   Full panel (`collapsed === false`, used on `<lg` mobile drawer + desktop
 *   when user has not collapsed the rail):
 *   ┃ [Sparkles] AI 助手 · model-name [×]        ← header with close button
 *   ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┃
 *   ┃  AiSidebar (input, generate…)             ┃
 *   ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┃
 *   ┃ ▸ 内容预览  [视频]                         ┃ ← disclosure
 *
 *   Rail (`collapsed === true`, desktop only):
 *   ┃                                          ┃
 *   ┃   ✨                                     ┃ ← primary affordance
 *   ┃                                          ┃
 *   ┃   [▢]                                    ┃ ← expand button
 *   ┃                                          ┃
 *
 * **Hierarchy**: the form on the left is wrapped in its own Card chrome
 * (primary surface). This right column intentionally has NO outer Card —
 * only a left hairline marks the boundary, so the panel reads as a
 * subordinate support surface to the form, not a peer.
 *
 * **Status**: AiSidebar already surfaces API-key status with full management
 * actions at the top of its own content. We deliberately do NOT duplicate
 * that here — the header only carries label + model identity. The rail
 * strips everything except the Sparkles affordance + an expand button so
 * the collapsed state is a single-glance signal, not a noisy chrome slab.
 */
export function PublishAiSidebar({
  mode,
  platform,
  onGenerated,
  previewMode,
  previewData,
  formRef,
  collapsed = false,
  onToggleCollapsed,
}: PublishAiSidebarProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const selectedModel = useAiStore((s) => s.selectedModel)
  const { isLoading: configLoading } = useAiConfig()

  const hasPreviewContent =
    previewData.title || previewData.desc || previewData.tags || previewData.fileUrls.length > 0

  // ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
  // OPT-3F rail: vertical 60px-wide strip with Sparkles + PanelRightOpen.
  // Mirrors the main AppShell sidebar's collapsed-icon-rail pattern.
  // `aria-expanded` on the open button ties screen readers to the
  // panel's visibility; `aria-controls` references the parent grid
  // (caller-appointed id "publish-ai-panel-region").
  // ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
  if (collapsed) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/50 px-1.5 py-3 shadow-sm"
        data-state="collapsed"
      >
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary',
            'select-none',
          )}
          aria-hidden="true"
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapsed}
          aria-label="打开 AI 助手"
          aria-expanded={false}
          className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div
      className="h-full flex flex-col rounded-xl border border-border/60 bg-card/50 shadow-sm"
      id="publish-ai-panel-region"
      data-state="expanded"
    >
      {/* ── Header: single refined row + OPT-3F close button ────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 h-11 border-b border-border/40">
        <div className="flex items-center gap-1.5 text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[13px] font-semibold tracking-tight">AI 助手</span>
        </div>            <span className="text-border/60" aria-hidden="true">·</span>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0 flex-1">
          {configLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>加载中</span>
            </>
          ) : (
            <span className="truncate max-w-[180px]" title={selectedModel}>
              {shortModel(selectedModel)}
            </span>
          )}
        </div>
        {onToggleCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapsed}
            aria-label="收起 AI 助手"
            aria-expanded={true}
            aria-controls="publish-ai-panel-region"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* ── Scrollable AI sidebar content ───────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 py-4">
          <AiSidebar mode={mode} platform={platform} onGenerated={onGenerated} formRef={formRef} />
        </div>
      </div>

      {/* ── Collapsible preview footer ──────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-border/40">
        <Button
          variant="ghost"
          onClick={() => setPreviewOpen((v) => !v)}
          className="w-full h-9 justify-between rounded-none px-4 text-xs font-medium hover:bg-muted/50"
        >
          <span className="flex items-center gap-2">
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            <span>内容预览</span>
            {hasPreviewContent && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                {previewMode === 'video' ? '视频' : '图文'}
              </Badge>
            )}
          </span>
          <motion.span
            animate={{ rotate: previewOpen ? 90 : 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex items-center text-muted-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </motion.span>
        </Button>
        <AnimatePresence initial={false}>
          {previewOpen && (
            <motion.div
              key="preview-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden bg-muted/30"
            >
              <div className="max-h-[42vh] overflow-y-auto p-3">
                <PublishPreview mode={previewMode} data={previewData} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
