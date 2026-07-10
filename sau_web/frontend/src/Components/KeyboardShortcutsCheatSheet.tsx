// ──────────────────────────────────────────────────────────────────────────
// Components/KeyboardShortcutsCheatSheet.tsx
//
// Global keyboard-shortcut reference modal — triggered by Cmd+? (macOS)
// or Ctrl+? (Win/Linux). Mirrors the pattern in Slack / Notion / Linear:
// one keypress surfaces every available shortcut so power users don't
// have to hunt through docs.
//
// Shortcut inventory (single source of truth — add new shortcuts here
// AND in the SHORTCUT_GROUPS array; the component derives the UI):
//
//   Global
//     ⌘K / Ctrl+K    — Toggle command palette
//     /              — Focus search input (TasksPage + global)
//     N              — New task (TasksPage) / New publish (global)
//     ⌘, / Ctrl+,    — Open Preferences (Overview tab)
//     ⌘? / Ctrl+?    — Open this cheat-sheet
//
//   TasksPage
//     R              — Refresh task list
//     N              — Open add-task modal
//     /              — Focus search input
//
//   Admin dashboard
//     ⌘1 / Ctrl+1    — Admin Overview tab
//     ⌘2 / Ctrl+2    — Admin Users tab
//     ⌘3 / Ctrl+3    — Admin Audit tab
//
//   Dialogs / Modals
//     Esc            — Close dialog / palette
//     ⌘Enter / Ctrl+Enter — Confirm destructive action (in confirm dialogs)
//
// Design:
//   • Grouped by context (Global, Tasks, Admin, Dialogs)
//   • Platform-aware modifier labels (⌘ on macOS, Ctrl+ on Win/Linux)
//   • Compact two-column grid inside a max-w-md Dialog
//   • Each entry: <kbd> shortcut + description
// ──────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/Components/ui/dialog'
import { Keyboard } from 'lucide-react'

const MODIFIER_LABEL =
  typeof navigator !== 'undefined' && /mac|darwin/i.test(navigator.platform)
    ? '⌘'
    : 'Ctrl+'

interface ShortcutEntry {
  keys: string
  description: string
}

interface ShortcutGroup {
  title: string
  entries: ShortcutEntry[]
}

function buildGroups(): ShortcutGroup[] {
  const m = MODIFIER_LABEL
  return [
    {
      title: '全局',
      entries: [
        { keys: `${m}K`, description: '切换命令面板' },
        { keys: `${m},`, description: '打开偏好设置' },
        { keys: `${m}?`, description: '打开快捷键参考' },
        { keys: 'N', description: '新建发布' },
        { keys: '/', description: '聚焦搜索框' },
      ],
    },
    {
      title: '侧边栏导航',
      entries: [
        { keys: `${m}1`, description: '账号管理' },
        { keys: `${m}2`, description: '发布中心' },
        { keys: `${m}3`, description: '任务列表' },
        { keys: `${m}4`, description: '数据分析' },
        { keys: `${m}5`, description: '运行日志' },
        { keys: `${m}6`, description: '素材收件箱' },
      ],
    },
    {
      title: '任务列表',
      entries: [
        { keys: 'R', description: '刷新任务列表' },
        { keys: '/', description: '聚焦搜索框' },
      ],
    },
    {
      title: '管理后台',
      entries: [
        { keys: `${m}1`, description: '概览页' },
        { keys: `${m}2`, description: '用户页' },
        { keys: `${m}3`, description: '审计页' },
      ],
    },
    {
      title: '弹窗与对话框',
      entries: [
        { keys: 'Esc', description: '关闭弹窗 / 命令面板' },
        { keys: `${m}Enter`, description: '确认操作（确认对话框内）' },
      ],
    },
  ]
}

interface KeyboardShortcutsCheatSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyboardShortcutsCheatSheet({
  open,
  onOpenChange,
}: KeyboardShortcutsCheatSheetProps) {
  const groups = buildGroups()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 h-12 border-b border-border/40">
          <Keyboard className="h-4 w-4 text-muted-foreground shrink-0" />
          <DialogHeader className="flex-row items-center gap-2 space-y-0">
            <DialogTitle className="text-sm font-medium">键盘快捷键</DialogTitle>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="max-h-[480px] overflow-y-auto px-5 py-4 space-y-5">
          {groups.map((group) => (
            <section key={group.title}>
              <h3 className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-2.5">
                {group.title}
              </h3>
              <div className="space-y-1.5">
                {group.entries.map((entry) => (
                  <div
                    key={entry.keys + entry.description}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="text-foreground/90">{entry.description}</span>
                    <kbd className="shrink-0 inline-flex h-5 items-center px-1.5 rounded border border-border/50 bg-muted/50 text-[11px] font-mono text-muted-foreground tabular-nums">
                      {entry.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 h-9 border-t border-border/40 text-[11px] text-muted-foreground bg-muted/30">
          <span>按 Esc 关闭</span>
          <span className="font-mono">{MODIFIER_LABEL}? 打开</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
