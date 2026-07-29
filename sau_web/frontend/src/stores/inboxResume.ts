import { useInboxStore, getInboxStore } from './inboxStore'

/** Guard against StrictMode double-invocation + repeated hydration callbacks. */
let _guard = false

export function __resetResumeGuard(): void {
  _guard = false
}

/**
 * Re-issue downloads/transcribes for entries persisted in a non-terminal
 * state (e.g., after page refresh while a request was in flight).
 *
 * Must run AFTER zustand persist rehydration — otherwise `entries` is still
 * the empty default and nothing resumes. Call via
 * `useInboxStore.persist.onFinishHydration` (see `__root.tsx`).
 */
export function resumeInterruptedDownloads(): void {
  if (_guard) return
  _guard = true
  const store = getInboxStore()
  if (!store) return
  for (const entry of store.entries) {
    if (entry.status === 'downloading') {
      if (!entry.url?.trim()) {
        // Disk-only / orphaned row — cannot re-fetch without a URL.
        useInboxStore.getState().updateEntry(entry.id, {
          status: 'failed',
          error: '下载中断且缺少原始链接，请重新粘贴链接下载',
        })
        continue
      }
      useInboxStore.getState().markInflight(entry.id)
      void _resumeDownload(entry)
    } else if (entry.status === 'transcribing') {
      if (!entry.filename) {
        useInboxStore.getState().updateEntry(entry.id, {
          status: 'failed',
          error: '转写中断且缺少文件名，请重新转写',
        })
        continue
      }
      useInboxStore.getState().markInflight(entry.id)
      void _resumeTranscribe(entry)
    }
  }
}

/**
 * Schedule resume once localStorage rehydration finishes.
 * Safe to call multiple times; only the first successful run executes work.
 */
export function scheduleInboxResume(): void {
  const run = () => {
    try {
      resumeInterruptedDownloads()
    } catch {
      /* private mode / storage blocked */
    }
  }

  // Persist API may be missing in some test envs.
  const persistApi = useInboxStore.persist
  if (!persistApi) {
    run()
    return
  }

  if (persistApi.hasHydrated()) {
    run()
    return
  }

  const unsub = persistApi.onFinishHydration(() => {
    unsub?.()
    run()
  })

  // Safety net: if hydration never fires (broken storage), still try once.
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (!_guard) run()
    }, 2_500)
  }
}

async function _resumeDownload(
  entry: { id: string; url: string },
): Promise<void> {
  const { inboxApi } = await import('@/api/inbox')
  try {
    const res = await inboxApi.inboxDownload(entry.url)
    if (res.success) {
      useInboxStore.getState().updateEntry(entry.id, {
        status: 'downloaded' as const,
        filename: res.filename,
        engine: res.engine,
        dir: res.dir,
        error: undefined,
      })
    } else {
      useInboxStore.getState().updateEntry(entry.id, {
        status: 'failed' as const,
        error: res.message ?? 'Download failed',
      })
    }
  } catch (e) {
    useInboxStore.getState().updateEntry(entry.id, {
      status: 'failed' as const,
      error: e instanceof Error ? e.message : 'Download failed',
    })
  } finally {
    useInboxStore.getState().clearInflight(entry.id)
  }
}

async function _resumeTranscribe(
  entry: { id: string; filename?: string },
): Promise<void> {
  const { inboxApi } = await import('@/api/inbox')
  try {
    let full = ''
    await inboxApi.inboxTranscribeStream(
      { filename: entry.filename ?? '' },
      (chunk: string) => {
        full += chunk
        useInboxStore.getState().appendTranscript(entry.id, chunk)
      },
      (_full: string) => {
        full = _full
      },
      (err: string) => {
        throw new Error(err)
      },
    )
    const trimmed = full.trim()
    if (
      trimmed.startsWith('转写失败') ||
      trimmed.startsWith('转写功能需要') ||
      trimmed.includes('转写服务未就绪')
    ) {
      throw new Error(trimmed.split('\n')[0] || '转写失败')
    }
    useInboxStore.getState().updateEntry(entry.id, {
      status: 'transcribed' as const,
      transcript: full,
      error: undefined,
    })
  } catch (e) {
    useInboxStore.getState().updateEntry(entry.id, {
      status: 'failed' as const,
      error: e instanceof Error ? e.message : 'Transcribe failed',
      transcript: undefined,
    })
  } finally {
    useInboxStore.getState().clearInflight(entry.id)
  }
}
