import { memo, useCallback, useState } from 'react'
import type { RefObject } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/Components/ui/accordion'
import {
  MaterialImageGrid,
  MaterialImageGridSkeleton,
  MaterialImageGridEmpty,
} from './MaterialImageGrid'
import { AddUrlForm } from './AddUrlForm'
import { useMaterialPanelStore } from '@/stores/materialPanelStore'
import { useMaterialAutoRecommend } from '@/hooks/useMaterialAutoRecommend'
import { aiApi, type NormalizedImage } from '@/api/ai'
import { useToast } from '@/Components/ui/toast'
import { Camera, ImageOff, Sparkles, Send } from 'lucide-react'
import { Input } from '@/Components/ui/input'
import { Button } from '@/Components/ui/button'
import { cn } from '@/lib/utils'
import type { FormHandle } from '@/lib/chat/chatFormBridge'

interface MaterialSectionProps {
  formMode: 'video' | 'note'
  formRef: RefObject<FormHandle | null>
  /**
   * Optional override for which Accordion item labels are visible.
   * Default: ['material', 'link']. Pass [] to render nothing (rare;
   * useful for callers that already gate the mount themselves).
   */
  enabledItems?: ReadonlyArray<'material' | 'link'>
}

/**
 * ai-sidebar-material-search §7.1 + §8 — the AI sidebar's "素材" surface.
 * Two-item Radix Accordion, mounted between the chat viewport and
 * composer (the slot owner is `<AiAssistantPanel>` which renders between
 * InlineMagicBar and Composer — see PublishAiSidebar.tsx for the layout
 * rationale). Both items default to collapsed (Accordion defaultValue
 * is `''`, never `'material'` or `'link'`) so chat viewport has full
 * height at panel mount, and the user opts into one or the other
 * section.
 *
 * Image section: input + recent-queries row + 3×3 manual-result grid
 * + 3×3 auto-recommend grid (separate slot per spec §"Auto-recommend
 * images by form title"). Auto-recommend is driven by the
 * `useMaterialAutoRecommend` hook (initial render), which polls
 * `formRef.getFormSnapshot().title` every 1.5s and dispatches
 * `recommendByTitle` on change.
 *
 * Link section: paste box + 「拉取」 button + progress banner + error
 * banner. Reuses `api.inboxDownload` (server-side yt-dlp +
 * patchright + BBDown) + `api.inboxFetchFile` for byte streaming.
 *
 * Layout invariant (spec §"PublishAiSidebar layout preserves chat
 * viewport"): both items collapse to 0px (Radix
 * `data-[state=closed]:animate-accordion-up` reserves no space);
 * when open, the IMAGE item caps at 380px and the LINK item at 240px
 * so the chat viewport always keeps `min-h-[240px]` (spec invariant).
 */
export const MaterialSection = memo(function MaterialSection({
  formMode,
  formRef,
  enabledItems = ['material', 'link'],
}: MaterialSectionProps) {
  // Spec §"auto-recommend hook lives inside MaterialSection" — Gemini
  // round-2 verdict: co-locating the polling logic with the feature
  // it serves avoids cross-domain pollution in PublishAiSidebar.
  useMaterialAutoRecommend(formRef)

  // ── Manual search wiring ──
  const searchImages = useMaterialPanelStore((s) => s.searchImages)
  const imageLoading = useMaterialPanelStore((s) => s.imageLoading)
  const imageError = useMaterialPanelStore((s) => s.imageError)
  const imageResults = useMaterialPanelStore((s) => s.imageResults)
  const recentQueries = useMaterialPanelStore((s) => s.recentQueries)

  const recommendResults = useMaterialPanelStore((s) => s.recommendResults)
  const recommendLoading = useMaterialPanelStore((s) => s.recommendLoading)
  const recommendError = useMaterialPanelStore((s) => s.recommendError)

  const showImageSection = enabledItems.includes('material')
  const showLinkSection = enabledItems.includes('link')

  if (!showImageSection && !showLinkSection) return null

  return (
    <div data-testid="material-section" className="flex-shrink-0 border-t border-border/40 bg-card/40">
      <Accordion type="multiple" className="w-full">
        {showImageSection && (
          <AccordionItem value="material" className="border-b-0">
            <AccordionTrigger className="px-4 py-2 hover:no-underline">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary">
                  <Camera className="h-3 w-3" />
                </div>
                <span className="text-[12px] font-medium">图片素材</span>
                <span className="text-[9px] font-mono text-muted-foreground/80">Pexels · Pixabay</span>
              </div>
            </AccordionTrigger>
            <AccordionContent
              className="px-4 pb-3 max-h-[380px] overflow-y-auto"
              data-testid="material-image-content"
            >
              <ImagePanelInner
                formMode={formMode}
                formRef={formRef}
                recentQueries={recentQueries}
                imageResults={imageResults}
                imageLoading={imageLoading}
                imageError={imageError}
                recommendResults={recommendResults}
                recommendLoading={recommendLoading}
                recommendError={recommendError}
                onSearch={searchImages}
              />
            </AccordionContent>
          </AccordionItem>
        )}
        {showLinkSection && (
          <AccordionItem value="link" className="border-b-0">
            <AccordionTrigger className="px-4 py-2 hover:no-underline">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary">
                  <Send className="h-3 w-3" />
                </div>
                <span className="text-[12px] font-medium">链接拉取</span>
                <span className="text-[9px] font-mono text-muted-foreground/80">yt-dlp + browser</span>
              </div>
            </AccordionTrigger>
            <AccordionContent
              className="px-4 pb-3 max-h-[240px] overflow-y-auto"
              data-testid="material-link-content"
            >
              <AddUrlForm formMode={formMode} formRef={formRef} />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  )
})

// ── inner image panel (extracted so the Accordion mount doesn't
//    re-render on every keystroke; only the inner's state changes) ───

interface ImagePanelInnerProps {
  formMode: 'video' | 'note'
  formRef: RefObject<FormHandle | null>
  recentQueries: string[]
  imageResults: NormalizedImage[]
  imageLoading: boolean
  imageError: string | null
  recommendResults: NormalizedImage[]
  recommendLoading: boolean
  recommendError: string | null
  onSearch: (query: string) => Promise<void>
}

const ImagePanelInner = memo(function ImagePanelInner({
  formMode,
  formRef,
  recentQueries,
  imageResults,
  imageLoading,
  imageError,
  recommendResults,
  recommendLoading,
  recommendError,
  onSearch,
}: ImagePanelInnerProps) {
  const { addToast } = useToast()
  const [query, setQuery] = useState('')
  // Map of NormalizedImage.id -> true while a single tile's "add-to-form"
  // request is in flight (debounces spam clicks on the same tile).
  // Pre-recommend: render the recommend grid first if it has items.
  const setImageQuery = useMaterialPanelStore((s) => s.setImageQuery)

  const triggerSearch = useCallback(
    async (q?: string) => {
      const term = (q ?? query).trim()
      if (!term) {
        addToast('请输入关键词', 'warning')
        return
      }
      try {
        await onSearch(term)
      } catch (err) {
        addToast(err instanceof Error ? err.message : '搜索失败', 'error')
      }
    },
    [query, onSearch, addToast],
  )

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void triggerSearch()
      }
    },
    [triggerSearch],
  )

  return (
    <div className="flex flex-col gap-2.5">
      {/* ── Search row ── */}
      <div className="flex items-center gap-1.5">
        <Input
          type="search"
          inputMode="search"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setImageQuery(e.target.value)
          }}
          onKeyDown={handleKey}
          placeholder="输入关键词回车搜图（Pexels + Pixabay）"
          className="h-7 flex-1 text-[11px]"
          data-testid="material-search-input"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void triggerSearch()}
          disabled={imageLoading || !query.trim()}
          className="h-7 px-2 text-[11px]"
          data-testid="material-search-submit"
        >
          搜索
        </Button>
      </div>

      {/* ── Recent queries (LRU chip row, LS-persisted max 3) ── */}
      {recentQueries.length > 0 && (
        <div className="flex items-center gap-1 text-[10px]">
          <span className="shrink-0 text-muted-foreground/70">历史:</span>
          <div className="flex flex-wrap gap-1">
            {recentQueries.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuery(q)
                  void triggerSearch(q)
                }}
                className={cn(
                  'rounded-full border border-border/40 px-1.5 py-0.5 text-[10px] leading-tight',
                  'transition-colors duration-100 hover:border-primary/40 hover:bg-primary/5',
                )}
                title={`重新搜索：${q}`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Manual results slot ── */}
      {imageError && !imageLoading ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive"
          role="alert"
          data-testid="material-image-error"
        >
          {imageError.length > 200 ? imageError.slice(0, 200) + '…' : imageError}
        </div>
      ) : imageLoading ? (
        <MaterialImageGridSkeleton />
      ) : imageResults.length > 0 ? (
        <MaterialImageGrid
          images={imageResults}
          sourceLabel="搜索结果"
          formMode={formMode}
          formRef={formRef}
        />
      ) : (
        <MaterialImageGridEmpty message="输入关键词，按回车搜图" />
      )}

      {/* ── Auto-recommend section (separate slot; persists across manual search) ── */}
      {(recommendResults.length > 0 || recommendLoading || recommendError) && (
        <div className="mt-1.5 border-t border-border/40 pt-2">
          <div className="flex items-center gap-1 mb-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-medium text-muted-foreground">为你推荐</span>
            <span className="ml-auto text-[9px] font-mono text-muted-foreground/60">
              {recommendLoading ? '...' : ''}
            </span>
          </div>
          {recommendError && !recommendLoading ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
              <ImageOff className="mr-1 inline h-3 w-3" />
              {recommendError.length > 200
                ? recommendError.slice(0, 200) + '…'
                : recommendError}
            </div>
          ) : recommendLoading ? (
            <MaterialImageGridSkeleton />
          ) : (
            <MaterialImageGrid
              images={recommendResults}
              sourceLabel=""
              formMode={formMode}
              formRef={formRef}
            />
          )}
        </div>
      )}
    </div>
  )
})
