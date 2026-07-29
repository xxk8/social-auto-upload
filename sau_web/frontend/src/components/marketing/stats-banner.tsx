import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

// ── StatsBanner — landing-only strip between Hero and Platforms ────────────
//
// 4-cell horizontal strip ("6 平台 / 3h+ 节省 / 0 上云 / 24-7 运转")
// rendered between LandingPage's HeroSection and PlatformsSection. Three
// cells animate their integer counter via CSS @property + counter-reset
// counter(), fired by a scroll-triggered IntersectionObserver that sets a
// `data-in-view` attribute on the strip's root. The 0-cloud cell renders
// as plain static text — animating 0→0 produces no visible motion but
// still incurs a registered property + animation cycle. Per design
// hygiene, we skip the animation entirely for that cell.
//
// The 4 cells live as enum entries; the 0-cloud variant is the only
// `counterCell: null` (rendered as static). Cell keys are kept in lock-
// step with the @property declarations + @keyframes in `index.css`:
//
//   data-stat-cell="c-platforms"   → --c-platforms   (initial 0 → 6)
//   data-stat-cell="c-hours-saved"→ --c-hours-saved(initial 0 → 3)
//   data-stat-cell="c-runtime"     → --c-runtime     (initial 0 → 24)
//
// Why a self-contained IO instead of leaning on `useRevealStagger`:
//  - Reveal stagger does *spatial* entrance (translateY + autoAlpha),
//    not *numeric* entrance. Animating a custom integer property is a
//    different mechanic — its IO cost and trigger semantics don't map
//    cleanly to GSAP's ScrollTrigger "start" / "once" model.
//  - Keeps the banner testable in isolation (no dependency on the
//    LandingPage's motion root ref).
//
// A11y:
//  - The visual cell is `aria-hidden` so SRs don't read out the
//    counting noise ("0... 1... 2... 6"). A sibling `sr-only` span
//    carries the composed final-value caption ("主流平台已覆盖 6 个")
//    so screen-reader users get the full meaning in one utterance.
//  - `prefers-reduced-motion: reduce` is handled globally in
//    `index.css` (animation-duration collapses to 0.01ms). Critically,
//    the cell rules below set `animation-fill-mode: forwards` so the
//    keyframe's `to {}` state stays bound when the duration shortcut
//    applies — no flash back to the initial `:root { --c-platforms: 0 }`
//    state once motion is collapsed.

type CounterCell = {
  /** Numeric target value (also used for sr-only label composition). */
  target: number
  /** Optional visual suffix appended next to the counter (e.g. "h+", "-7"). */
  suffix: string
  /** data-stat-cell attribute value. Mirrors the @property + keyframe in index.css. */
  cellKey: 'c-platforms' | 'c-hours-saved' | 'c-runtime'
}

type StaticCell = {
  /** Static text — bypasses the @property animation entirely. */
  staticValue: string
}

type BannerStat = (CounterCell | StaticCell) & {
  captionKey: string
  captionFallback: string
}

const STATS: ReadonlyArray<BannerStat> = [
  {
    cellKey: 'c-platforms',
    target: 6,
    suffix: '',
    captionKey: 'marketing.stats.caption_platforms',
    captionFallback: '主流平台已覆盖',
  },
  {
    cellKey: 'c-hours-saved',
    target: 3,
    suffix: 'h+',
    captionKey: 'marketing.stats.caption_hours_saved',
    captionFallback: '每天节省发布时长',
  },
  {
    staticValue: '0',
    captionKey: 'marketing.stats.caption_cloud',
    captionFallback: '视频文件上云',
  },
  {
    cellKey: 'c-runtime',
    target: 24,
    suffix: '-7',
    captionKey: 'marketing.stats.caption_runtime',
    captionFallback: '小时自动调度',
  },
]

export function StatsBanner() {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Trigger count-up once when ~25% of the strip enters the viewport.
    // Disconnect after first fire so re-scrolling back doesn't replay
    // the counter — avoids distracting repeat numbers.
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.setAttribute('data-in-view', 'true')
            io.disconnect()
          }
        })
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-stats-banner
      className="relative border-b border-border/40 bg-muted/30 px-6 py-12 sm:py-16"
      role="group"
      aria-label={t('marketing.stats.banner_label', '信任指标概览')}
    >
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-y-8 sm:grid-cols-4 sm:gap-y-0">
        {STATS.map((stat, i) => {
          const isStatic = 'staticValue' in stat
          const lastInRow = i === STATS.length - 1
          const srLabel = isStatic
            ? `${stat.staticValue} ${t(stat.captionKey, stat.captionFallback)}`
            : `${stat.target} ${t(stat.captionKey, stat.captionFallback)}`
          return (
            <div
              key={stat.captionKey}
              className={cn(
                'flex flex-col items-center text-center',
                // Vertical hairline divider between cells at sm+. Skip for
                // the very last cell so the right edge sits flush with
                // the section's outer hairline.
                !lastInRow && 'sm:border-r sm:border-border/30 sm:pr-4',
                i > 0 && 'sm:pl-4',
              )}
            >
              <span className="sr-only">{srLabel}</span>
              <div aria-hidden className="flex items-baseline gap-0.5">
                {isStatic ? (
                  <span className="font-mono text-[3.5rem] font-semibold leading-none tracking-tight text-foreground sm:text-[4rem]">
                    {stat.staticValue}
                  </span>
                ) : (
                  <>
                    <span
                      data-stat-cell={stat.cellKey}
                      className="font-mono text-[3.5rem] font-semibold leading-none tracking-tight text-foreground sm:text-[4rem]"
                    />
                    {stat.suffix && (
                      <span className="font-mono text-2xl font-medium text-primary/70 sm:text-3xl">
                        {stat.suffix}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="mt-3 text-[12px] font-medium text-muted-foreground/80">
                {t(stat.captionKey, stat.captionFallback)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
