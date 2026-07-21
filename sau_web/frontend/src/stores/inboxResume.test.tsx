import { describe, it, expect, beforeEach, vi } from 'vitest'

// Round-XXX second-batch migration: replaced legacy `vi.mock('@/api/client', …)`
// with an explicit `vi.mock('@/api/inbox', …)` that mirrors the same
// methods (`inboxDownload` + `inboxTranscribeStream`). The legacy
// `@/api/client` mock was targeting the deprecated barrel; the actual
// production consumer of these methods is `inboxApi` (imported from
// `@/api/inbox` below). Mocking the real domain module makes the
// contract explicit and removes the implicit reliance on the setup.ts
// Proxy fallback.
vi.mock('@/api/inbox', () => ({
  inboxApi: {
    inboxDownload: vi.fn(),
    inboxTranscribeStream: vi.fn(),
  },
}))


import { useInboxStore, getInboxStore } from './inboxStore'
import { resumeInterruptedDownloads, __resetResumeGuard } from './inboxResume'
import { inboxApi } from '@/api/inbox'

const LS_KEY = 'sau-inbox'

const mockedDownload = inboxApi.inboxDownload as unknown as ReturnType<typeof vi.fn>
const mockedTranscribe = inboxApi.inboxTranscribeStream as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_KEY)
  useInboxStore.getState().reset()
  __resetResumeGuard()
  mockedDownload.mockReset()
  mockedTranscribe.mockReset()
})

describe('resumeInterruptedDownloads()', () => {
  it('re-issues downloads for entries persisted as downloading', async () => {
    useInboxStore.setState({
      entries: [
        {
          id: 'd1',
          url: 'https://example.com/a.mp4',
          status: 'downloading',
          startedAt: 1000,
        },
      ],
    })
    mockedDownload.mockResolvedValue({
      success: true,
      filename: 'a_done.mp4',
      engine: 'yt-dlp',
      dir: '/videos/inbox',
    })

    resumeInterruptedDownloads()

    // markInflight ran synchronously.
    expect(getInboxStore().inflightEntryIds.has('d1')).toBe(true)
    expect(mockedDownload).toHaveBeenCalledTimes(1)
    expect(mockedDownload).toHaveBeenCalledWith('https://example.com/a.mp4')

    // Allow the async callback to resolve.
    await vi.waitFor(() => {
      expect(getInboxStore().entries[0]?.status).toBe('downloaded')
    })
    expect(getInboxStore().entries[0]?.filename).toBe('a_done.mp4')
    expect(getInboxStore().inflightEntryIds.has('d1')).toBe(false)
  })

  it('re-streams transcribe for entries persisted as transcribing', async () => {
    useInboxStore.setState({
      entries: [
        {
          id: 't1',
          url: 'https://example.com/b.mp4',
          status: 'transcribing',
          filename: 'b.mp4',
        },
      ],
    })
    mockedTranscribe.mockImplementation(
      async (
        _payload: { filename: string },
        onChunk: (c: string) => void,
        onDone: (full: string) => void,
      ) => {
        // Mimic readTextStream: stream chunks first, then onDone(full).
        onChunk('hello ')
        onChunk('world')
        onDone('hello world')
      },
    )

    resumeInterruptedDownloads()

    expect(mockedTranscribe).toHaveBeenCalledTimes(1)
    expect(mockedTranscribe).toHaveBeenCalledWith(
      { filename: 'b.mp4' },
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    )

    await vi.waitFor(() => {
      expect(getInboxStore().entries[0]?.status).toBe('transcribed')
    })
    expect(getInboxStore().entries[0]?.transcript).toBe('hello world')
  })

  it('does NOT re-issue finished/failed rows', () => {
    useInboxStore.setState({
      entries: [
        { id: 'ok', url: 'u', status: 'downloaded', filename: 'f.mp4' },
        { id: 'fail', url: 'u', status: 'failed', error: 'e' },
        { id: 'tr', url: 'u', status: 'transcribed', filename: 'f.mp4' },
      ],
    })

    resumeInterruptedDownloads()

    expect(mockedDownload).not.toHaveBeenCalled()
    expect(mockedTranscribe).not.toHaveBeenCalled()
  })

  it('is idempotent within a session (StrictMode double-invoke safe)', () => {
    useInboxStore.setState({
      entries: [
        { id: 'd2', url: 'https://example.com/c.mp4', status: 'downloading' },
      ],
    })
    mockedDownload.mockResolvedValue({
      success: true,
      filename: 'c_done.mp4',
      engine: 'yt-dlp',
      dir: '/videos/inbox',
    })

    resumeInterruptedDownloads()
    resumeInterruptedDownloads()

    expect(mockedDownload).toHaveBeenCalledTimes(1)
  })

  it('marks a download failure as failed (not stuck in-flight)', async () => {
    useInboxStore.setState({
      entries: [
        { id: 'd3', url: 'https://example.com/d.mp4', status: 'downloading' },
      ],
    })
    mockedDownload.mockResolvedValue({ success: false, message: 'boom' })

    resumeInterruptedDownloads()

    await vi.waitFor(() => {
      expect(getInboxStore().entries[0]?.status).toBe('failed')
    })
    expect(getInboxStore().entries[0]?.error).toBe('boom')
    expect(getInboxStore().inflightEntryIds.has('d3')).toBe(false)
  })
})
