import { memo, useState, useCallback, useRef } from 'react'
import { Button } from '@/Components/ui/button'
import { Input } from '@/Components/ui/input'
import { Label } from '@/Components/ui/label'
import { Checkbox } from '@/Components/ui/checkbox'
import { Card, CardContent } from '@/Components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/Components/ui/collapsible'
import { Sparkles, ChevronDown, Loader2, Zap, Globe } from 'lucide-react'
import { api } from '@/api/client'
import { VariantCard } from './VariantCard'
import type { ContentVariant, VariantError } from '@/lib/ai/types'

interface ContentVariantsPanelProps {
  onApplyVariant: (variant: ContentVariant) => void
}

export const ContentVariantsPanel = memo(function ContentVariantsPanel({
  onApplyVariant,
}: ContentVariantsPanelProps) {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [useSearch, setUseSearch] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [results, setResults] = useState<Map<string, ContentVariant | VariantError>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const handleGenerate = useCallback(async () => {
    if (!topic.trim()) return
    setGenerating(true)
    setResults(new Map())
    setError(null)
    abortRef.current = new AbortController()

    const newResults = new Map<string, ContentVariant | VariantError>()

    await api.generateVariantsStream(
      { topic: topic.trim(), search: useSearch },
      (result) => {
        newResults.set(result.style, result)
        setResults(new Map(newResults))
      },
      (errResult) => {
        newResults.set(errResult.style, errResult)
        setResults(new Map(newResults))
      },
      () => {
        setGenerating(false)
      },
      (msg) => {
        setError(msg)
        setGenerating(false)
      },
      abortRef.current.signal,
    )
  }, [topic, useSearch])

  const handleRetry = useCallback(async (style: string) => {
    if (!topic.trim()) return
    const controller = new AbortController()
    const singleResults = new Map(results)
    singleResults.delete(style)
    setResults(singleResults)

    await api.generateVariantsStream(
      { topic: topic.trim(), search: useSearch },
      (result) => {
        singleResults.set(result.style, result)
        setResults(new Map(singleResults))
      },
      (errResult) => {
        singleResults.set(errResult.style, errResult)
        setResults(new Map(singleResults))
      },
      () => {},
      () => {},
      controller.signal,
    )
  }, [topic, results, useSearch])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setGenerating(false)
  }, [])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-dashed">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-between w-full p-4 cursor-pointer hover:bg-muted/50 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">AI 内容生成</span>
              <span className="text-[11px] text-muted-foreground">输入主题，一键生成4种风格方案</span>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="p-4 pt-0 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cv-topic" className="text-sm">主题 / 关键词</Label>
              <Input
                id="cv-topic"
                name="topic"
                placeholder="输入你想创作的内容主题，如：Python爬虫教程、探店杭州咖啡馆..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !generating) handleGenerate()
                }}
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={useSearch}
                onCheckedChange={(checked) => setUseSearch(checked === true)}
                className="h-4 w-4"
              />
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">联网搜索</span>
              <span className="text-[11px] text-muted-foreground/60">搜索最新信息，生成更准确的内容</span>
            </label>

            <div className="flex gap-2">
              {generating ? (
                <Button variant="secondary" onClick={handleStop} className="gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  停止生成
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={!topic.trim()}
                  className="gap-2"
                >
                  <Zap className="h-4 w-4" />
                  一键生成
                </Button>
              )}
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
                {error}
              </div>
            )}

            {results.size > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from(results.entries()).map(([style, variant]) => (
                  <VariantCard
                    key={style}
                    variant={variant}
                    onApply={onApplyVariant}
                    onRetry={handleRetry}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
})
