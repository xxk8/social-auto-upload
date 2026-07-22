/**
 * `PlatformVariantBubble` — compact platform chip-card render for
 * `/variants` assistant bubbles.
 *
 * Sits between the synthetic `/variants <topic>` user bubble and the
 * next user turn in the chat scroll. Each platform bubble is an
 * independent assistant sibling, so the user can apply one platform's
 * payload to the form without committing to the rest.
 *
 * The bubble pulls:
 *   - `<PlatformIcon platform=...>` for visual identity.
 *   - Chinese label via a frontend lookup map. We intentionally
 *     resolve on the frontend (not store `platformLabel` in the
 *     ChatMessage) — keeps the message schema lean and means a
 *     rename in `api/types.ts::PLATFORMS` propagates here on next
 *     render without any data migration.
 *   - `parseAssistantResult(content)` to surface title / desc / tags.
 *     The hook `useAiChat.generateVariants` formats the assistant
 *     text exactly as `标题：...\n描述：...\n标签：...` so the regex
 *     here picks the fields up identically to the legacy single-LLM
 *     path.
 *   - `parseError: true` ⇄ raw LLM output didn't pass JSON parse —
 *     the bubble falls back to a compact `[解析失败]` badge plus
 *     the raw error string, plus the apply button is disabled.
 *
 * No form coupling here — the apply side-effect is owned by the
 * parent (the Panel) and passed as `onApply`. Keeps the bubble a
 * pure presentational component.
 */
/* eslint-disable react-refresh/only-export-components */
import { CheckCheck } from 'lucide-react'
import { PlatformIcon } from '@/components/ui/platform-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PLATFORMS, NOTE_PLATFORMS } from '@/api/types'
import { parseAssistantResult } from './AiAssistantPanel'
import { parseTags } from '@/lib/tags'
import type { ChatMessage } from '@/lib/chat/types'

export interface PlatformVariantBubbleProps {
  message: ChatMessage
  /**
   * Apply callback: parent owns the side-effect onto the
   * publish-form ref. Bubble stays pure / testable without
   * form coupling.
   */
  onApply: (parsed: {
    title?: string
    desc?: string
    tags?: string[]
  }) => void
}

/**
 * Lookup the Chinese label for a platform id. Falls back to the
 * raw id (e.g. `'tencent'` → `'视频号'`; unknown → `'tencent'`).
 * `api/types.ts::PLATFORMS` covers the video-mode list;
 * `NOTE_PLATFORMS` covers the note-mode list. Merged into one map
 * (note-mode wins on overlap for visual consistency).
 *
 * Exported so the Panel can use the same resolver for toast labels
 * (one source of truth for "what to display when a platform id
 * meets the user").
 */
export function labelFor(platform: string): string {
  const noteLabel = NOTE_PLATFORMS.find((p) => p.value === platform)?.label
  if (noteLabel) return noteLabel
  const videoLabel = PLATFORMS.find((p) => p.value === platform)?.label
  if (videoLabel) return videoLabel
  return platform
}

function truncate(text: string | undefined, max: number): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

export function PlatformVariantBubble({
  message,
  onApply,
}: PlatformVariantBubbleProps) {
  const platform = message.platform ?? ''
  const label = labelFor(platform)
  const isError = message.parseError === true

  // Even on parse-error we attempt to extract title/desc/tags so
  // partial salvageable fields can show up — but the apply button
  // stays disabled because at least one field set is suspect.
  const parsed = parseAssistantResult(message.content)
  const tagList = parsed.tags ? parseTags(parsed.tags) : []
  const title = truncate(parsed.title, 60)
  const desc = truncate(parsed.desc, 100)
  const hasParsed = !!(title || desc || tagList.length)

  return (
    <div
      className={cn(
        'flex gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200',
      )}
      data-testid="platform-variant-bubble"
      data-platform={platform}
    >
      <RoleAvatar role="assistant" />
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'rounded-xl border bg-card/70 px-3 py-2.5 text-[12.5px] leading-relaxed',
            'shadow-[0_1px_0_0_color-mix(in_oklab,var(--border)_55%,transparent)]',
            isError
              ? 'border-destructive/40 bg-destructive/[0.04]'
              : 'border-primary/30 bg-primary/[0.04]',
          )}
        >
          {/* ── Header: platform icon + label + optional badge ── */}
          <header className="mb-1.5 flex items-center gap-1.5">
            <PlatformIcon
              platform={platform}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span
              className="font-mono text-[10px] tracking-wider text-muted-foreground"
              aria-label={`Platform ${label}`}
            >
              {label}
            </span>
            <span className="text-border/40" aria-hidden="true">·</span>
            <span className="font-mono text-[10px] tracking-wider text-muted-foreground/80">
              AI · variant
            </span>
            {isError && (
              <Badge
                variant="outline"
                className="ml-1 h-4 px-1 text-[9px] border-destructive/40 text-destructive"
              >
                解析失败
              </Badge>
            )}
          </header>

          {/* ── Body: parsed fields OR raw error ── */}
          {isError ? (
            <div className="text-[12px] text-destructive/90 whitespace-pre-wrap break-words font-mono">
              {message.content}
            </div>
          ) : hasParsed ? (
            <div className="grid gap-1 pl-0.5 text-[12px]">
              {title && (
                <div className="text-muted-foreground inline-flex items-baseline gap-1.5">
                  <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">标题</Badge>
                  <span className="text-foreground/90 truncate">{title}</span>
                </div>
              )}
              {desc && (
                <div className="text-muted-foreground inline-flex items-baseline gap-1.5">
                  <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">描述</Badge>
                  <span className="text-foreground/85 truncate">{desc}</span>
                </div>
              )}
              {tagList.length > 0 && (
                <div className="text-muted-foreground inline-flex items-baseline gap-1.5">
                  <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">标签</Badge>
                  <span className="text-foreground/85 truncate font-mono text-[11px]">
                    {tagList.slice(0, 6).join(' · ')}
                    {tagList.length > 6 ? ' …' : ''}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[12px] text-foreground/85 whitespace-pre-wrap break-words">
              {message.content}
            </div>
          )}

          {/* ── Footer: apply button ── */}
          <footer className="mt-2 flex items-center justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isError || !hasParsed}
              onClick={() =>
                onApply({
                  title: parsed.title || undefined,
                  desc: parsed.desc || undefined,
                  tags: tagList.length > 0 ? tagList : undefined,
                })
              }
              className="h-6 px-2 text-[10px] gap-1 text-primary"
              data-testid="platform-variant-apply"
            >
              <CheckCheck className="h-3 w-3" />
              应用到表单
            </Button>
          </footer>
        </div>
      </div>
    </div>
  )
}

/**
 * Local avatar — duplicated from `AiAssistantPanel` so the bubble
 * stays a leaf-level component (no parent coupling). When the panel's
 * avatar primitive becomes exported, swap this for an import.
 */
function RoleAvatar({ role }: { role: 'user' | 'assistant' | 'system' }) {
  if (role !== 'assistant') {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted font-mono text-[10px] font-semibold text-muted-foreground" aria-hidden>
        {role === 'user' ? '你' : 'sys'}
      </div>
    )
  }
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 font-mono text-[10px] font-semibold text-primary"
      aria-hidden
    >
      AI
    </div>
  )
}
