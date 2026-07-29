import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'sau:publish:split'
const DEFAULT_LEFT_PCT = 60
const MIN_LEFT_PCT = 30
const MAX_LEFT_PCT = 80

export interface ResizablePanelProps {
  left: ReactNode
  right: ReactNode

  /** Initial left-panel percentage (0–100). Defaults to 60. */
  defaultLeftPct?: number
  /** Min left-panel percentage. Defaults to 30. */
  minLeftPct?: number
  /** Max left-panel percentage. Defaults to 80. */
  maxLeftPct?: number
  /** Persist split position to localStorage under this key. */
  storageKey?: string
  className?: string
}

/**
 * Two-panel layout with a draggable vertical splitter.
 *
 * Below the `lg` breakpoint the panels stack (left on top) and the splitter
 * is hidden — matching the existing responsive behaviour of PublishPage.
 * On `lg+` the splitter is active and the split position is clamped to
 * [minLeftPct, maxLeftPct] and persisted to localStorage.
 */
export function ResizablePanel({
  left,
  right,
  defaultLeftPct = DEFAULT_LEFT_PCT,
  minLeftPct = MIN_LEFT_PCT,
  maxLeftPct = MAX_LEFT_PCT,
  storageKey = STORAGE_KEY,
  className,
}: ResizablePanelProps) {
  const [leftPct, setLeftPct] = useState(defaultLeftPct)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  // Load persisted split on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = localStorage.getItem(storageKey)
    if (!raw) return
    const pct = Number(raw)
    if (!Number.isNaN(pct) && pct >= minLeftPct && pct <= maxLeftPct) {
      setLeftPct(pct)
    }
  }, [storageKey, minLeftPct, maxLeftPct])

  // Persist on change.
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(storageKey, String(leftPct))
  }, [leftPct, storageKey])

  const clamp = (pct: number) =>
    Math.min(Math.max(pct, minLeftPct), maxLeftPct)

  const startDrag = useCallback(
    (_clientX: number) => {
      const container = containerRef.current
      if (!container) return

      const move = (e: Event) => {
        const point =
          'touches' in e
            ? (e as TouchEvent).touches[0]?.clientX
            : (e as MouseEvent).clientX
        if (point == null) return
        const rect = container.getBoundingClientRect()
        const pct = ((point - rect.left) / rect.width) * 100
        rafRef.current = window.requestAnimationFrame(() => {
          setLeftPct(clamp(pct))
        })
      }

      const stop = () => {
        setIsDragging(false)
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', stop)
        window.removeEventListener('touchmove', move, false)
        window.removeEventListener('touchend', stop)
      }

      setIsDragging(true)
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', stop)
      window.addEventListener('touchmove', move, false)
      window.addEventListener('touchend', stop)
    },
    [minLeftPct, maxLeftPct],
  )

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const point = 'touches' in e ? e.touches[0]?.clientX : e.clientX
      if (point == null) return
      e.preventDefault()
      startDrag(point)
    },
    [startDrag],
  )

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const leftStyle: CSSProperties = {
    width: `${leftPct}%`,
    flex: `0 0 ${leftPct}%`,
  }
  const rightStyle: CSSProperties = {
    width: `${100 - leftPct}%`,
    flex: `0 0 ${100 - leftPct}%`,
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex h-full w-full items-stretch gap-4 lg:gap-0',
        className,
      )}
    >
      <div
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={leftStyle}
      >
        {left}
      </div>

      {/* Splitter — only interactive on lg+ */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整面板比例"
        title="拖拽调整左右面板比例"
        className={cn(
          'group relative z-10 flex shrink-0 cursor-col-resize items-center justify-center',
          'hidden h-full w-4 touch-none select-none lg:flex',
          'transition-all duration-200 ease-out',
          isDragging && 'w-5',
        )}
        onMouseDown={handlePointerDown}
        onTouchStart={handlePointerDown}
      >
        {/* Visual guide rail */}
        <div
          className={cn(
            'absolute inset-y-6 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-all duration-200',
            isDragging
              ? 'bg-primary/30'
              : 'bg-border/40 group-hover:bg-primary/15 group-hover:w-[3px]',
          )}
        />
        {/* Grip dots */}
        <div className="relative z-10 flex flex-col items-center gap-[3px]">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                'h-[3px] w-[3px] rounded-full transition-all duration-200',
                isDragging
                  ? 'bg-primary/80 scale-125'
                  : 'bg-muted-foreground/20 group-hover:bg-primary/60 group-hover:scale-125',
              )}
              style={{
                animation:
                  !isDragging
                    ? `hint-pulse 0.7s ease-out ${0.4 + i * 0.12}s 1`
                    : undefined,
              }}
            />
          ))}
        </div>
      </div>

      <div
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={rightStyle}
      >
        {right}
      </div>
    </div>
  )
}
