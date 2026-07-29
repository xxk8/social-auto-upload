/**
 * Claude Code-style slash menu — appears when the composer text starts with `/`.
 * Click inserts the command into the textarea (does not auto-send so the
 * user can fill args). Enter still sends via the normal composer path.
 */
import { useEffect, useState } from 'react'
import { filterSlashCommands } from './magicCommands'
import { cn } from '@/lib/utils'
import { Terminal } from 'lucide-react'

interface SlashCommandMenuProps {
  /** Selector for the composer textarea inside ComposerPrimitive.Root */
  inputSelector?: string
}

export function SlashCommandMenu({
  inputSelector = '[data-testid="ai-composer"] textarea',
}: SlashCommandMenuProps) {
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const root = document.querySelector('[data-testid="ai-composer"]')
    if (!root) return

    const onInput = () => {
      const el = document.querySelector(inputSelector) as HTMLTextAreaElement | null
      if (!el) {
        setQuery(null)
        return
      }
      const v = el.value
      // Only show when the whole buffer is a slash command draft
      // (starts with / and has no newline — like Claude Code).
      if (v.startsWith('/') && !v.includes('\n')) {
        setQuery(v)
        setActive(0)
      } else {
        setQuery(null)
      }
    }

    root.addEventListener('input', onInput, true)
    root.addEventListener('keyup', onInput, true)
    return () => {
      root.removeEventListener('input', onInput, true)
      root.removeEventListener('keyup', onInput, true)
    }
  }, [inputSelector])

  if (query === null) return null
  const items = filterSlashCommands(query)
  if (items.length === 0) return null

  const pick = (cmd: string, args?: string) => {
    const el = document.querySelector(inputSelector) as HTMLTextAreaElement | null
    if (!el) return
    const next = args ? `${cmd} ` : `${cmd} `
    // Prefer native value setter so React controlled inputs update.
    const proto = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )
    proto?.set?.call(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
    setQuery(next.trimEnd().includes(' ') ? null : next)
  }

  return (
    <div
      className="mx-3 mb-1 overflow-hidden rounded-xl border border-border/30 bg-popover shadow-sm"
      data-testid="ai-slash-menu"
      role="listbox"
      aria-label="斜杠命令"
    >
      <div className="flex items-center gap-2 border-b border-border/20 bg-gradient-to-r from-primary/[0.03] to-transparent px-3.5 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Terminal className="h-3 w-3" />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          命令
        </span>
      </div>
      <ul className="max-h-52 overflow-y-auto py-1">
        {items.map((item, i) => (
          <li key={item.cmd}>
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              className={cn(
                'flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-all duration-150',
                i === active
                  ? 'bg-primary/5 ring-1 ring-primary/20'
                  : 'hover:bg-muted/50',
              )}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item.cmd, item.args)}
            >
              <code className="mt-0.5 shrink-0 rounded-md bg-gradient-to-b from-primary/10 to-primary/5 px-2 py-0.5 font-mono text-[11px] font-medium text-primary ring-1 ring-primary/15">
                {item.cmd}
              </code>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-foreground leading-snug">
                  {item.label}
                  {item.args ? (
                    <span className="ml-1 font-normal text-muted-foreground/50">
                      {item.args}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/70">
                  {item.blurb}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
