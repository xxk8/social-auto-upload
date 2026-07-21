import { Link } from 'react-router-dom'
import { Users, Send, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

const rows = [
  { label: '账号管理', icon: Users, active: false },
  { label: '发布中心', icon: Send, active: true },
  { label: '任务列表', icon: BarChart3, active: false },
]

export function SidebarRowDemo() {
  return (
    <div className="flex w-56 flex-col gap-0.5 rounded-lg border bg-sidebar p-2">
      <span className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
        导航
      </span>
      {rows.map((row) => {
        const Icon = row.icon
        return (
          <Link
            key={row.label}
            to="#"
            className={cn(
              'group relative flex items-center rounded-lg px-2.5 py-2 mx-0.5 gap-2.5 text-[13px] font-medium transition-all duration-150',
              row.active
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
            )}
          >
            {row.active && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full bg-primary" />
            )}
            <Icon
              className={cn(
                'h-4 w-4',
                row.active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
              )}
            />
            <span className={cn('truncate', row.active && 'font-medium')}>{row.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
