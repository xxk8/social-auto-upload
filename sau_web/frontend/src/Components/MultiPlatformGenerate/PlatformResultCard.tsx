import { memo, useId, useState, useCallback } from 'react'
import { Button } from '@/Components/ui/button'
import { Input } from '@/Components/ui/input'
import { Label } from '@/Components/ui/label'
import { Textarea } from '@/Components/ui/textarea'
import { Badge } from '@/Components/ui/badge'
import { Card, CardContent } from '@/Components/ui/card'
import { Copy, Check, AlertCircle, RotateCcw } from 'lucide-react'
import type { PlatformResult, PlatformError } from '@/lib/ai/types'

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  kuaishou: '快手',
  bilibili: 'Bilibili',
  tencent: '视频号',
  tiktok: 'TikTok',
  baijiahao: '百家号',
}

const PLATFORM_COLORS: Record<string, string> = {
  douyin: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  xiaohongshu: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  kuaishou: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  bilibili: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  tencent: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  tiktok: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  baijiahao: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
}

interface PlatformResultCardProps {
  result: PlatformResult | PlatformError
  onApply: (result: PlatformResult) => void
  onRetry?: (platform: string) => void
}

export const PlatformResultCard = memo(function PlatformResultCard({
  result,
  onApply,
  onRetry,
}: PlatformResultCardProps) {
  // Round-form-audit: multiple PlatformResultCards render together
  // (one per platform). React.useId() gives each card instance its
  // own stable id namespace so the inner title/desc inputs + their
  // <Label htmlFor> bindings stay unique across the page.
  const titleId = useId()
  const descId = useId()
  const [edited, setEdited] = useState<PlatformResult>({ ...result })
  const [applied, setApplied] = useState(false)

  const handleApply = useCallback(() => {
    onApply(edited)
    setApplied(true)
    setTimeout(() => setApplied(false), 2000)
  }, [edited, onApply])

  // Inlined type guard so TypeScript narrows `result` to
  // `PlatformError` inside the if-block AND to `PlatformResult`
  // after the early-return. Using a captured boolean
  // (`const isError = 'error' in result && result.error`) prior to
  // this rewrite didn't propagate the narrowing — TS2339 surfaced
  // at `result.parseError` on line 90 saying it doesn't exist on
  // 'PlatformResult | PlatformError'. The inlined guard operates
  // on `result` itself so the discriminated union narrows as
  // expected. Same root cause and pattern applies in VariantCard.
  // Type guard: `PlatformResult` lacks an `error` property entirely
  // while `PlatformError` has `error: string`. The `in` operator
  // narrows `result` to `PlatformError` inside the if-block AND
  // to `PlatformResult` after the early-return — IF we DON'T add
  // a `&& result.error` truthy check (which keeps the union by
  // ruling out empty-string errors but not non-string fields).
  // The earlier `const isError = 'error' in result && result.error`
  // capture worked similarly; the inline form here gives the same
  // narrowing onto `result` itself so TS resolves parseError after
  // the early-return as `boolean | undefined`.
  if ('error' in result) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className={PLATFORM_COLORS[result.platform] ?? ''}>
              {PLATFORM_LABELS[result.platform] ?? result.platform}
            </Badge>
            {onRetry && (
              <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => onRetry(result.platform)}>
                <RotateCcw className="h-3 w-3" />
                重试
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{result.error}</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={PLATFORM_COLORS[result.platform] ?? ''}>
            {PLATFORM_LABELS[result.platform] ?? result.platform}
          </Badge>
          <div className="flex items-center gap-1">
            {result.parseError && (
              <Badge variant="secondary" className="text-[10px]">JSON解析降级</Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1"
              onClick={handleApply}
              disabled={applied}
            >
              {applied ? (
                <><Check className="h-3 w-3" /> 已应用</>
              ) : (
                <><Copy className="h-3 w-3" /> 应用到表单</>
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <Label htmlFor={titleId} className="text-[11px] text-muted-foreground">标题</Label>
            <Input
              id={titleId}
              value={edited.title}
              onChange={(e) => setEdited((prev) => ({ ...prev, title: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label htmlFor={descId} className="text-[11px] text-muted-foreground">描述</Label>
            <Textarea
              id={descId}
              value={edited.description}
              onChange={(e) => setEdited((prev) => ({ ...prev, description: e.target.value }))}
              className="min-h-[60px] text-sm"
            />
          </div>
          {edited.tags.length > 0 && (
            <div>
              <span className="text-[11px] text-muted-foreground">标签</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {edited.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    #{tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
})
