import { useState, useCallback, useRef } from 'react'
import { api } from '@/api/client'

interface TagRecommendationOptions {
  title: string
  description?: string
  platform?: string
}

export function useTagRecommendation() {
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const recommend = useCallback(async ({ title, description, platform }: TagRecommendationOptions) => {
    if (!title.trim()) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setTags([])
    setError(null)

    const platformHint = platform
      ? `\n目标平台：${platform}。请推荐适合该平台风格的标签。`
      : ''

    const systemPrompt = `你是一个社交媒体标签推荐专家。根据用户提供的标题和描述，推荐5-10个相关的热门标签。
${platformHint}

严格规则：
1. 只返回一个JSON数组，格式：["标签1", "标签2", "标签3"]
2. 标签用中文（除非目标平台是TikTok/YouTube）
3. 不要包含 # 号，只返回标签文字
4. 不要返回任何其他文字，只返回JSON数组`

    const userContent = description
      ? `标题：${title}\n描述：${description}`
      : `标题：${title}`

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]

    let fullContent = ''

    try {
      await api.generateMessagesStream(
        { messages, model: 'google/gemma-4-26b-a4b-it:free' },
        (chunk) => { fullContent += chunk },
        (final) => {
          const raw = (final || fullContent).trim()
          const parsed = parseTagArray(raw)
          setTags(parsed)
          setLoading(false)
        },
        (msg) => {
          setError(msg)
          setLoading(false)
        },
        undefined,
        abortRef.current.signal,
      )
    } catch {
      setLoading(false)
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  const clear = useCallback(() => {
    setTags([])
    setError(null)
  }, [])

  return { tags, loading, error, recommend, cancel, clear }
}

function parseTagArray(raw: string): string[] {
  if (raw.startsWith('```')) {
    const lines = raw.split('\n').filter((l) => !l.trim().startsWith('```'))
    raw = lines.join('\n').trim()
  }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed
    }
  } catch { /* fallback below */ }

  const match = raw.match(/\[[\s\S]*\]/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed
      }
    } catch { /* give up */ }
  }
  return []
}
