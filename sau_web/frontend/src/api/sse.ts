/**
 * 通用 SSE 流读取工具。
 *
 * 5 个流式方法（generateMultiPlatformStream / generateVariantsStream /
 * enhancePrompt / generateAiContentStream / generateMessagesStream）
 * 共享完全相同的读取循环逻辑，只是 URL、payload、事件分发不同。
 * 此函数消除 ~300 行重复。
 */

/** SSE 事件处理器集合 */
export interface SSEHandlers {
  onChunk?: (content: string) => void
  onDone?: (fullContent: string) => void
  onError?: (message: string) => void
  onKeyInfo?: (keyId: number, masked: string) => void
  onPlatformResult?: (data: unknown) => void
  onPlatformError?: (data: unknown) => void
  onVariantResult?: (data: unknown) => void
  onVariantError?: (data: unknown) => void
}

/**
 * 发起 SSE POST 请求并流式读取响应。
 *
 * @param url - 完整请求 URL
 * @param payload - POST body（JSON 序列化）
 * @param handlers - 事件回调
 * @param signal - 可选的 AbortSignal
 */
export async function readSSEStream(
  url: string,
  payload: Record<string, unknown>,
  handlers: SSEHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    handlers.onError?.(err instanceof Error ? err.message : 'Network error')
    return
  }

  if (!resp.ok) {
    try {
      const errBody = await resp.json()
      handlers.onError?.(errBody.message || `HTTP ${resp.status}`)
    } catch {
      handlers.onError?.(`HTTP ${resp.status}`)
    }
    return
  }

  const reader = resp.body?.getReader()
  if (!reader) {
    handlers.onError?.('No response body')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let doneReceived = false

  try {
    let eventType = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
          continue
        }
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            switch (eventType) {
              case 'data':
                fullContent += (data.content ?? '')
                handlers.onChunk?.(data.content ?? '')
                break
              case 'done':
                doneReceived = true
                handlers.onDone?.(data.content ?? fullContent)
                break
              case 'key_info':
                if (handlers.onKeyInfo && typeof data.id === 'number') {
                  handlers.onKeyInfo(data.id, data.masked || '')
                }
                break
              case 'platform_result':
                handlers.onPlatformResult?.(data)
                break
              case 'platform_error':
                handlers.onPlatformError?.(data)
                break
              case 'variant_result':
                handlers.onVariantResult?.(data)
                break
              case 'variant_error':
                handlers.onVariantError?.(data)
                break
              case 'error':
                handlers.onError?.(data.message || 'Unknown error')
                return
            }
          } catch {
            // 静默跳过格式异常的行，生产环境可考虑 console.warn
          }
        }
      }
    }
    if (!doneReceived && fullContent) {
      handlers.onDone?.(fullContent)
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    handlers.onError?.(err instanceof Error ? err.message : 'Stream error')
  } finally {
    reader.releaseLock()
  }
}

/**
 * 纯文本流读取（非 SSE），用于 inboxTranscribeStream 等场景。
 */
export async function readTextStream(
  url: string,
  payload: Record<string, unknown>,
  onChunk: (chunk: string) => void,
  onDone: (fullText: string) => void,
  onError: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    onError(err instanceof Error ? err.message : 'Network error')
    return
  }

  if (!resp.ok) {
    try {
      const errBody = await resp.json()
      onError(errBody.message || `HTTP ${resp.status}`)
    } catch {
      onError(`HTTP ${resp.status}`)
    }
    return
  }

  const reader = resp.body?.getReader()
  if (!reader) {
    onError('No response body')
    return
  }

  const decoder = new TextDecoder()
  let full = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      full += chunk
      onChunk(chunk)
    }
    onDone(full)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    onError(err instanceof Error ? err.message : 'Stream error')
  } finally {
    reader.releaseLock()
  }
}