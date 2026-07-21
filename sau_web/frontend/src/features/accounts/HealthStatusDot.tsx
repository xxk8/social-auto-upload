import { cn } from '@/lib/utils'
import { toneDotClasses, type Tone } from '@/lib/tone'

export type HealthStatus = 'healthy' | 'stale' | 'unhealthy' | 'unknown'

interface HealthStatusDotProps {
  status: HealthStatus
  className?: string
  title?: string
}

const STATUS_TONE: Record<HealthStatus, Tone> = {
  healthy: 'success',
  stale: 'warning',
  unhealthy: 'error',
  unknown: 'info',
}

const STATUS_TITLE: Record<HealthStatus, string> = {
  healthy: 'Cookie 有效',
  stale: 'Cookie 过期，建议刷新',
  unhealthy: 'Cookie 失效，需要重新登录',
  unknown: '状态未知',
}

export function HealthStatusDot({ status, className, title }: HealthStatusDotProps) {
  const tone = STATUS_TONE[status] ?? 'info'
  const dotClasses = toneDotClasses(tone)

  return (
    <span
      className={cn(
        'inline-flex h-2.5 w-2.5 rounded-full flex-shrink-0',
        dotClasses,
        className,
      )}
      title={title ?? STATUS_TITLE[status]}
      aria-label={title ?? STATUS_TITLE[status]}
    />
  )
}
