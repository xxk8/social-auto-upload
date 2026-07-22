import { memo } from 'react'
import { cn } from '@/lib/utils'
import { toneChipClasses, toneFillBgClass } from '@/lib/tone'

type HealthStatus = 'valid' | 'expiring_soon' | 'invalid' | 'unknown'

interface HealthBadgeProps {
  health?: HealthStatus
  className?: string
}

const HEALTH_META: Record<
  HealthStatus,
  { label: string; tone: 'success' | 'warning' | 'error' | 'info' }
> = {
  valid: { label: '健康', tone: 'success' },
  expiring_soon: { label: '即将过期', tone: 'warning' },
  invalid: { label: '已失效', tone: 'error' },
  unknown: { label: '未检查', tone: 'info' },
}

function HealthBadgeImpl({ health = 'unknown', className }: HealthBadgeProps) {
  const meta = HEALTH_META[health]
  return (
    <span
      data-tone={health}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap',
        toneChipClasses(meta.tone),
        className,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', toneFillBgClass(meta.tone))} />
      {meta.label}
    </span>
  )
}

export const HealthBadge = memo(HealthBadgeImpl)
