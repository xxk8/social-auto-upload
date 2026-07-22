import { memo, useId, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Copy, Check, AlertCircle, RotateCcw } from 'lucide-react'
import type { ContentVariant, VariantError } from '@/lib/ai/types'

const STYLE_COLORS: Record<string, string> = {
  attention: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  professional: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  friendly: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  creative: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

interface VariantCardProps {
  variant: ContentVariant | VariantError
  onApply: (variant: ContentVariant) => void
  onRetry?: (style: string) => void
}

export const VariantCard = memo(function VariantCard({
  variant,
  onApply,
  onRetry,
}: VariantCardProps) {
  // Round-form-audit: VariantCard renders N times on the same page
  // (one card per AI style). React.useId() gives each instance its
  // own id namespace so the inner title/desc inputs + <Label htmlFor>
  // bindings stay unique across cards.
  const titleId = useId()
  const descId = useId()
  const [edited, setEdited] = useState<ContentVariant>({ ...variant })
  const [applied, setApplied] = useState(false)

  const handleApply = useCallback(() => {
    onApply(edited)
    setApplied(true)
    setTimeout(() => setApplied(false), 2000)
  }, [edited, onApply])

  // Inlined type guard so TypeScript narrows `variant` to
  // `VariantError` inside the if-block AND to `ContentVariant`
  // after the early-return. See the matching comment in
  // PlatformResultCard for the rationale — same TS2339 root cause
  // at `variant.parseError`. Inlining operates on `variant`
  // itself, which TS's discriminated-union narrowing tracks.
  // Same type-guard narrowing pattern as PlatformResultCard (the
  // `&& variant.error` truthy check would keep the union across
  // the early-return boundary; drop it so `variant.parseError`
  // resolves to `boolean | undefined` post-return).
  if ('error' in variant) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className={STYLE_COLORS[variant.style] ?? ''}>
              {variant.styleLabel}
            </Badge>
            {onRetry && (
              <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => onRetry(variant.style)}>
                <RotateCcw className="h-3 w-3" />
                重试
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{variant.error}</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={STYLE_COLORS[variant.style] ?? ''}>
            {variant.styleLabel}
          </Badge>
          <div className="flex items-center gap-1">
            {variant.parseError && (
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
