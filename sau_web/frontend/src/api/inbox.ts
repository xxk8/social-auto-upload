import { request } from './request'
import { readNdjsonStream, readTextStream } from './sse'

const baseURL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV ? '' : 'http://localhost:6001')

export type SubtitleStreamEvent =
  | { type: 'progress'; phase: string; pct: number; label: string }
  | {
      type: 'done'
      data: {
        mode: string
        detected_language?: string
        srt_filename: string
        srt_url: string
        srt_text: string
        burned_filename?: string | null
        burned_url?: string | null
        burn_method?: 'hard' | 'soft' | null
        quality?: string
      }
    }
  | { type: 'error'; message: string }

export const inboxApi = {
  inboxList() {
    return request.get('/api/inbox/list').then((res) => res.data)
  },

  inboxDownload(url: string, signal?: AbortSignal) {
    return request
      .post('/api/inbox/download', { url }, { timeout: 300_000, signal })
      .then((res) => res.data)
  },

  async inboxFetchFile(filename: string, mimeHint?: string): Promise<File> {
    const resp = await fetch(`${baseURL}/api/inbox/file/${encodeURIComponent(filename)}`, {
      credentials: 'include',
    })
    if (!resp.ok) {
      let bodyText: string
      try {
        const body = await resp.json()
        bodyText = body?.message || `HTTP ${resp.status}`
      } catch {
        bodyText = `HTTP ${resp.status}`
      }
      throw new Error(bodyText)
    }
    const blob = await resp.blob()
    return new File([blob], filename, {
      type: mimeHint || blob.type || 'video/mp4',
    })
  },

  inboxReveal(filename?: string) {
    return request.post('/api/inbox/reveal', { filename }).then((res) => res.data)
  },

  inboxDelete(payload: {
    filename?: string
    filenames?: string[]
    srt_filenames?: string[]
  }) {
    return request.post('/api/inbox/delete', payload).then((res) => res.data as {
      success: boolean
      message?: string
      data?: { deleted: string[]; missing: string[]; srt_deleted: string[] }
    })
  },

  inboxClear() {
    return request.post('/api/inbox/clear', {}).then((res) => res.data as {
      success: boolean
      message?: string
      data?: { deleted: string[]; missing: string[]; srt_deleted: string[] }
    })
  },

  inboxStorage() {
    return request.get('/api/inbox/storage').then((res) => res.data as {
      success: boolean
      data?: {
        inbox: { bytes: number; count: number; oldest?: string; newest?: string }
        subtitles: { bytes: number; count: number }
        thumbs: { bytes: number; count: number }
        total_bytes: number
      }
    })
  },

  inboxCleanup(payload: { older_than_days?: number; keep_subtitled?: boolean }) {
    return request.post('/api/inbox/cleanup', payload).then((res) => res.data as {
      success: boolean
      message?: string
      data?: { deleted: string[]; srt_deleted: string[]; thumbs_deleted?: number }
    })
  },

  inboxThumbUrl(filename: string) {
    return `${baseURL}/api/inbox/thumb/${encodeURIComponent(filename)}`
  },

  async inboxTranscribeStream(
    payload: { filename: string },
    onChunk: (chunk: string) => void,
    onDone: (fullText: string) => void,
    onError: (message: string) => void,
    signal?: AbortSignal,
  ) {
    await readTextStream(
      `${baseURL}/api/inbox/transcribe`,
      payload as unknown as Record<string, unknown>,
      onChunk, onDone, onError, signal,
    )
  },

  /**
   * Stream subtitle job with progress events (NDJSON).
   */
  async inboxSubtitleStream(
    payload: {
      filename: string
      mode?: 'bilingual' | 'zh' | 'en' | 'source'
      burn?: boolean
      burn_style?: 'auto' | 'hard' | 'soft'
      quality?: 'original' | '1080' | '720' | '480'
    },
    onEvent: (ev: SubtitleStreamEvent) => void,
    onError: (message: string) => void,
    signal?: AbortSignal,
  ) {
    await readNdjsonStream(
      `${baseURL}/api/inbox/subtitle`,
      payload as unknown as Record<string, unknown>,
      (raw) => {
        const t = raw.type
        if (t === 'progress' || t === 'done' || t === 'error') {
          onEvent(raw as unknown as SubtitleStreamEvent)
        }
      },
      onError,
      signal,
    )
  },

  /** @deprecated prefer inboxSubtitleStream for progress */
  inboxSubtitle(payload: {
    filename: string
    mode?: 'bilingual' | 'zh' | 'en' | 'source'
    burn?: boolean
    burn_style?: 'auto' | 'hard' | 'soft'
    quality?: 'original' | '1080' | '720' | '480'
  }) {
    return new Promise<{
      success: boolean
      message?: string
      data?: SubtitleStreamEvent extends { type: 'done'; data: infer D } ? D : never
    }>((resolve, reject) => {
      void inboxApi.inboxSubtitleStream(
        payload,
        (ev) => {
          if (ev.type === 'done') {
            resolve({ success: true, data: ev.data as never })
          } else if (ev.type === 'error') {
            resolve({ success: false, message: ev.message })
          }
        },
        (msg) => reject(new Error(msg)),
      )
    })
  },

  inboxOrganize(filenames: string[]) {
    return request
      .post('/api/inbox/organize', { filenames }, { timeout: 60_000 })
      .then((res) => res.data as {
        success: boolean
        message?: string
        data?: {
          dirname: string
          count: number
          path: string
        }
      })
  },

  inboxSubtitleSave(payload: {
    filename: string
    srt_text: string
    burn?: boolean
    burn_style?: 'auto' | 'hard' | 'soft'
    quality?: string
    mode?: string
  }) {
    return request
      .post('/api/inbox/subtitle/save', payload, { timeout: 900_000 })
      .then((res) => res.data as {
        success: boolean
        message?: string
        data?: {
          srt_filename: string
          srt_url: string
          srt_text: string
          burned_filename?: string | null
          burned_url?: string | null
          burn_method?: string | null
        }
      })
  },
}
