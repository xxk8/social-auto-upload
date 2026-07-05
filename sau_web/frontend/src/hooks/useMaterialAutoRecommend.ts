import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { FormHandle } from '@/lib/chat/chatFormBridge'
import { useMaterialPanelStore } from '@/stores/materialPanelStore'

const POLL_INTERVAL_MS = 1500
const RECOMMEND_CAP = 3
const HIDDEN_RESET_SEC = 30

/**
 * ai-sidebar-material-search §8 — auto-recommend hook. Polls the form
 * title every 1.5s (no onFormChange callback needed — keeps the
 * bridge contract one-way); calls `materialPanelStore.recommendByTitle`
 * when:
 *   - title is non-empty
 *   - title changed since last recommend
 *   - recommendCount < RECOMMEND_CAP (3)
 *
 * visibilitychange: if tab is hidden ≥ HIDDEN_RESET_SEC (30s), reset
 * the cap on resume so a user walking away for 30+ min returns to a
 * fresh slate — they get up to 3 NEW recommendations as if the panel
 * just remounted. Spec §"Session recommendation cap" calls this out.
 *
 * Strictly a UI-side concern — the cap is intentionally NOT persisted
 * (a user opening a new tab should NOT carry forward an old cap; the
 * store init gives `recommendCount: 0` on a fresh page-load).
 *
 * Mount scope: caller is MaterialSection; called once per AiAssistantPanel
 * lifetime. Resets to a fresh slate when the publish page remounts.
 */
export function useMaterialAutoRecommend(formRef: RefObject<FormHandle | null>): void {
  const recommendByTitle = useMaterialPanelStore((s) => s.recommendByTitle)
  const reset = useMaterialPanelStore((s) => s.reset)
  // Track the last hidden timestamp so visibilitychange knows when ≥30s.
  const hiddenSinceRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const interval = window.setInterval(() => {
      const ref = formRef.current
      if (!ref) return
      // safeGetFormSnapshot is a try/catch helper from chatFormBridge.ts
      // — fall through silently if the form is mid-unmount.
      let trimmed: string
      try {
        const snap = ref.getFormSnapshot()
        trimmed = (snap?.title ?? '').trim()
      } catch {
        return
      }
      if (!trimmed) return
      // `recommendCount` reads via store accessor (re-get on each tick);
      // store updates inside recommendByTitle will cap further calls
      // on the NEXT tick since lastRecommendedTitle === trimmed then.
      const { recommendCount, lastRecommendedTitle } = useMaterialPanelStore.getState()
      if (recommendCount >= RECOMMEND_CAP) return
      if (trimmed === lastRecommendedTitle) return
      void recommendByTitle(trimmed, /* force */ false)
    }, POLL_INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now()
      } else if (document.visibilityState === 'visible' && hiddenSinceRef.current !== null) {
        const elapsedSec = (Date.now() - hiddenSinceRef.current) / 1000
        hiddenSinceRef.current = null
        if (elapsedSec >= HIDDEN_RESET_SEC) {
          // Fresh-slate reset: clear cap + results. The very next tick
          // will re-poll the title and re-fire recommend if it has changed.
          reset()
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [formRef, recommendByTitle, reset])
}
