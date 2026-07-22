import { memo, useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Sparkles, ChevronDown, Loader2, Zap } from 'lucide-react'
import { api, PLATFORMS } from '@/api/client'
import { PlatformResultCard } from './PlatformResultCard'
import type { PlatformResult, PlatformError } from '@/lib/ai/types'

interface MultiPlatformGeneratePanelProps {
  onApplyResult: (result: PlatformResult) => void
}

export const MultiPlatformGeneratePanel = memo(function MultiPlatformGeneratePanel({
  onApplyResult,
}: MultiPlatformGeneratePanelProps) {
  const [open, setOpen] = useState(true)
  const [topic, setTopic] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['douyin', 'xiaohongshu', 'kuaishou', 'bilibili'])
  const [generating, setGenerating] = useState(false)
  const [results, setResults] = useState<Map<string, PlatformResult | PlatformError>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    )
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!topic.trim() || selectedPlatforms.length === 0) return
    setGenerating(true)
    setResults(new Map())
    setError(null)
    abortRef.current = new AbortController()

    const newResults = new Map<string, PlatformResult | PlatformError>()

    await api.generateMultiPlatformStream(
      { topic: topic.trim(), platforms: selectedPlatforms },
      (result) => {
        newResults.set(result.platform, result)
        setResults(new Map(newResults))
      },
      (errResult) => {
        newResults.set(errResult.platform, errResult)
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
  }, [topic, selectedPlatforms])

  const handleRetry = useCallback(async (platform: string) => {
    if (!topic.trim()) return
    const controller = new AbortController()
    const singleResults = new Map(results)
    singleResults.delete(platform)
    setResults(singleResults)

    await api.generateMultiPlatformStream(
      { topic: topic.trim(), platforms: [platform] },
      (result) => {
        singleResults.set(result.platform, result)
        setResults(new Map(singleResults))
      },
      (errResult) => {
        singleResults.set(errResult.platform, errResult)
        setResults(new Map(singleResults))
      },
      () => {},
      () => {},
      controller.signal,
    )
  }, [topic, results])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setGenerating(false)
  }, [])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-dashed">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">AI 多平台内容生成</span>
              <span className="text-[11px] text-muted-foreground">输入主题，一键生成全平台内容</span>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="p-4 pt-0 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mpg-topic" className="text-sm">主题 / 关键词</Label>
              <Input
                id="mpg-topic"
                name="topic"
                placeholder="输入你想创作的内容主题，如：Python爬虫教程、探店杭州咖啡馆..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !generating) handleGenerate()
                }}
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">目标平台</span>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <label
                    key={p.value}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border cursor-pointer text-sm transition-colors ${
                      selectedPlatforms.includes(p.value) ? 'bg-primary/10 border-primary/30' : 'hover:bg-muted/50'
                    }`}
                  >
                    <Checkbox
                      checked={selectedPlatforms.includes(p.value)}
                      onCheckedChange={() => togglePlatform(p.value)}
                      className="h-3.5 w-3.5"
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              {generating ? (
                <Button variant="secondary" onClick={handleStop} className="gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  停止生成
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={!topic.trim() || selectedPlatforms.length === 0}
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
                {Array.from(results.entries()).map(([platform, result]) => (
                  <PlatformResultCard
                    key={platform}
                    result={result}
                    onApply={onApplyResult}
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
