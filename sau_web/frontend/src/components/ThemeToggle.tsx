import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from './ThemeProvider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ThemeToggleProps = {
  /**
   * Visual size of the icon button.
   * - `default` (32×32 button + 16×16 icon) — used in the desktop top bar,
   *   mobile header, onboarding tour, and any other prominent spot.
   * - `compact` (28×28 button + 14×14 icon) — for tight containers that
   *   already host a peer icon button of equivalent size (e.g. the
   *   sidebar-footer's logout+theme pill). Pairing mismatched button
   *   heights inside one container reads as visually cramped.
   */
  size?: 'default' | 'compact'
}

export function ThemeToggle({ size = 'default' }: ThemeToggleProps = {}) {
  const { resolved, setTheme } = useTheme()

  const isDark = resolved === 'dark'

  const toggle = () => {
    setTheme(isDark ? 'light' : 'dark')
  }

  const isCompact = size === 'compact'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          data-testid="theme-toggle"
          aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
          className={cn(isCompact ? 'h-7 w-7' : 'h-8 w-8')}
        >
          {isDark ? (
            <Moon className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          ) : (
            <Sun className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{isDark ? '切换到浅色' : '切换到深色'}</p>
      </TooltipContent>
    </Tooltip>
  )
}
