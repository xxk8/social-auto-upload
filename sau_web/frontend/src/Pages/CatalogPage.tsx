import { MDXProvider } from '@mdx-js/react'
import {ToastProvider} from '@/Components/ui/toast';import { Button } from '@/Components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/Components/ui/card'
import { Input } from '@/Components/ui/input'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/Components/ui/popover'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/Components/ui/dialog'
import { Badge } from '@/Components/ui/badge'
import { Progress } from '@/Components/ui/progress'
import { Demo } from '@/Components/catalog/Demo'
import { SidebarRowDemo } from '@/Components/catalog/SidebarRowDemo'
import { ToastDemo } from '@/Components/catalog/ToastDemo'
// DESIGN-components.mdx lives inside the vite project tree at
// `sau_web/frontend/content/` so vite's project-root-scoped resolver
// can find `node_modules/react` and `@mdx-js/react`. The text-only
// twin DESIGN-components.md stays at the repo root.
// Path: src/Pages/ → src/ → frontend/ → content/DESIGN-components.mdx
import Content from '../../content/DESIGN-components.mdx'

const components = {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Input,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Badge,
  Progress,
  Demo,
  SidebarRowDemo,
  ToastDemo,
}

export default function CatalogPage() {
  return (
    <ToastProvider>
      <article className="min-h-screen w-full bg-background text-foreground">
        <div className="mx-auto max-w-4xl px-6 py-10 prose prose-slate dark:prose-invert">
          <MDXProvider components={components}>
            <Content />
          </MDXProvider>
        </div>
      </article>
    </ToastProvider>
  )
}
