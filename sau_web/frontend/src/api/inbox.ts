import { request } from './request'
import { readTextStream } from './sse'

const baseURL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV ? '' : 'http://localhost:6001')

export const inboxApi = {
  inboxList() {
    return request.get('/api/inbox/list').then((res) => res.data)
  },

  inboxDownload(url: string) {
    return request.post('/api/inbox/download', { url }, { timeout: 300_000 }).then((res) => res.data)
  },

  // ── ai-sidebar-material-search §7.3 ─────────────────────────────────
  // Fetch the bytes of an inbox-saved file by `filename`. Used after
  // `inboxDownload` succeeds — the server saves to disk (videos/*/inbox/)
  // and returns `{success, filename, engine}`; we then stream back the
  // bytes so the file can be wrapped as a `File` and passed to
  // `safeApplyMedia(formRef, {file})` for video-mode URL→apply flow.
  // The server endpoint is `GET /api/inbox/file/<name>` (Flask
  // `send_from_directory`) — global `before_request` hook handles auth.
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
}