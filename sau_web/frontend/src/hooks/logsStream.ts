/**
 * Process-wide single EventSource for `/api/logs/stream`.
 *
 * LogsPage + FloatingLogs share one connection instead of N parallel SSE
 * sockets (same pattern as tasksStream.ts).
 */
import { api, type LogEntry } from '../api/client'

type Listener = (entry: LogEntry) => void

let refCount = 0
let closeStream: (() => void) | null = null
const listeners = new Set<Listener>()

function openIfNeeded() {
  if (closeStream || typeof EventSource === 'undefined') return
  const ac = new AbortController()
  const stream = api.streamLogs({ signal: ac.signal })
  stream.onLog((entry) => {
    for (const fn of listeners) fn(entry)
  })
  closeStream = () => {
    ac.abort()
    stream.close()
    closeStream = null
  }
}

function closeIfIdle() {
  if (refCount > 0) return
  closeStream?.()
  closeStream = null
}

export function subscribeLogsStream(onLog: Listener): () => void {
  listeners.add(onLog)
  refCount += 1
  openIfNeeded()
  return () => {
    listeners.delete(onLog)
    refCount = Math.max(0, refCount - 1)
    closeIfIdle()
  }
}

export function isLogsStreamSupported() {
  return typeof EventSource !== 'undefined'
}
