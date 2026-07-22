import { useInboxStore, getInboxStore } from './inboxStore'

/** Guard against StrictMode double-invocation. */
let _guard = false

export function __resetResumeGuard(): void {
  _guard = false
}

/**
 * Re-issue downloads/transcribes for entries persisted in a non-terminal
 * state (e.g., after page refresh while streaming).
 */
export function resumeInterruptedDownloads(): void {
  if (_guard) return
  _guard = true
  const store = getInboxStore()
  if (!store) return
  for (const entry of store.entries) {
    if (entry.status === 'downloading') {
      useInboxStore.getState().markInflight(entry.id)
      void _resumeDownload(entry)
    } else if (entry.status === 'transcribing') {
      useInboxStore.getState().markInflight(entry.id)
      void _resumeTranscribe(entry)
    }
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
      },
      (_full: string) => {
        full = _full
      },
      (err: string) => {
        throw new Error(err)
      },
    )
    useInboxStore.getState().updateEntry(entry.id, {
      status: 'transcribed' as const,
      transcript: full,
    })
  } catch (e) {
    useInboxStore.getState().updateEntry(entry.id, {
      status: 'failed' as const,
      error: e instanceof Error ? e.message : 'Transcribe failed',
    })
  } finally {
    useInboxStore.getState().clearInflight(entry.id)
  }
}
