/**
 * Process-wide single EventSource for `/api/tasks/stream`.
 *
 * Multiple `useTasks()` mounts (Accounts overview + Tasks page +
 * CommandPalette) must not open N parallel SSE connections. This
 * module ref-counts subscribers and multiplexes frames to all of them.
 */
import { api, type TaskItem } from '../api/client'

type Listener = (tasks: TaskItem[]) => void
type ErrorListener = () => void

let refCount = 0
let closeStream: (() => void) | null = null
const dataListeners = new Set<Listener>()
const errorListeners = new Set<ErrorListener>()

function openIfNeeded() {
  if (closeStream || typeof EventSource === 'undefined') return

  const ac = new AbortController()
  const stream = api.streamTasks(ac.signal)

  stream.onMessage((tasks) => {
    for (const fn of dataListeners) fn(tasks)
  })
  stream.onError(() => {
    for (const fn of errorListeners) fn()
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

/** Subscribe to the shared tasks SSE. Returns an unsubscribe fn. */
export function subscribeTasksStream(
  onData: Listener,
  onError?: ErrorListener,
): () => void {
  dataListeners.add(onData)
  if (onError) errorListeners.add(onError)
  refCount += 1
  openIfNeeded()

  return () => {
    dataListeners.delete(onData)
    if (onError) errorListeners.delete(onError)
    refCount = Math.max(0, refCount - 1)
    closeIfIdle()
  }
}

export function isTasksStreamSupported() {
  return typeof EventSource !== 'undefined'
}
