import { useState, useCallback } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface NavItem {
  path: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  shortcut?: string
  // `readonly` here is the AppShell-side contract boundary: callers
  // pass a frozen list (e.g. AppShell's `readonly DashboardNavItem[]`)
  // and SidebarNav does NOT mutate the children array — it only
  // iterates and recurses. Readonly matches the actual usage and
  // resolves the TS2322 error at AppShell.tsx:472 (AdminNavItem's
  // `readonly AdminNavItem[]` children must flow into SidebarNav
  // without losing immutability on the way through the `items`
  // prop). SidebarNav's recursive call site
  // (`item.children?.map(child => ...)`) still works on a readonly
  // array because Array.prototype.map is read-only.
  children?: readonly NavItem[]
}

interface SidebarNavProps {
  items: NavItem[]
  isCollapsed?: boolean
  onNavigate?: () => void
  modifierLabel?: string
}

export function SidebarNav({ items, isCollapsed, onNavigate, modifierLabel = '⌘' }: SidebarNavProps) {
  const location = useLocation()

  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => (
        <SidebarNavItem
          key={item.path}
          item={item}
          isCollapsed={isCollapsed}
          onNavigate={onNavigate}
          modifierLabel={modifierLabel}
          currentPath={location.pathname}
        />
      ))}
    </div>
  )
}

function SidebarNavItem({
  item,
  isCollapsed,
  onNavigate,
  modifierLabel,
  currentPath,
}: {
  item: NavItem
  isCollapsed?: boolean
  onNavigate?: () => void
  modifierLabel: string
  currentPath: string
}) {
  const hasChildren = item.children && item.children.length > 0
  // For items with children, never show as active page
  // For items without children, only exact match (no startsWith)
  const isActive = hasChildren
    ? false
    : currentPath === item.path
  const hasActiveChild = hasChildren && item.children?.some(
    child => currentPath === child.path
  )
  const [isOpen, setIsOpen] = useState(hasActiveChild)

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open)
  }, [])

  if (!hasChildren) {
    return (
      <Link
        className={cn(
          "group relative flex items-center rounded-lg text-[13px] font-medium transition-all duration-150",
          isCollapsed ? "justify-center px-2 py-2 mx-0.5" : "px-2.5 py-2 mx-0.5 gap-2.5",
          isActive
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
        )}
        to={item.path}
        onClick={onNavigate}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full bg-primary" />
        )}
        <item.icon className={cn(
          "h-4 w-4 shrink-0 transition-all duration-150",
          isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
        )} />
        {!isCollapsed && (
          <>
            <span className={cn(
              "truncate transition-all duration-150 flex-1",
              isActive && "font-medium"
            )}>
              {item.label}
            </span>
            {item.shortcut && (
              <kbd className="hidden sm:inline-flex h-3.5 items-center px-1 rounded border border-border/40 bg-muted/40 text-[9px] font-mono text-muted-foreground/70 tabular-nums">
                {modifierLabel}{item.shortcut}
              </kbd>
            )}
          </>
        )}
        {isCollapsed && (
          <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-150 whitespace-nowrap z-50 shadow-lg scale-95 group-hover:scale-100">
            {item.label}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-foreground rotate-45" />
          </div>
        )}
      </Link>
    )
  }

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "group relative flex w-full items-center rounded-lg text-[13px] font-medium transition-all duration-150",
            isCollapsed ? "justify-center px-2 py-2 mx-0.5" : "px-2.5 py-2 mx-0.5 gap-2.5",
            hasActiveChild
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
          )}
        >
          <item.icon className={cn(
            "h-4 w-4 shrink-0 transition-all duration-150",
            hasActiveChild ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
          )} />
          {!isCollapsed && (
            <>
              <span className="truncate transition-all duration-150 flex-1 text-left">
                {item.label}
              </span>
              <ChevronRight className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                isOpen && "rotate-90"
              )} />
            </>
          )}
          {isCollapsed && (
            <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-150 whitespace-nowrap z-50 shadow-lg scale-95 group-hover:scale-100">
              {item.label}
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-foreground rotate-45" />
            </div>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn("flex flex-col gap-0.5", isCollapsed ? "ml-0" : "ml-4")}>
          {item.children?.map((child) => (
            <SidebarNavItem
              key={child.path}
              item={child}
              isCollapsed={isCollapsed}
              onNavigate={onNavigate}
              modifierLabel={modifierLabel}
              currentPath={currentPath}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
