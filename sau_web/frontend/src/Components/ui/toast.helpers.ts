// ──────────────────────────────────────────────────────────────────────────
// ui/toast.helpers.ts — `react-refresh/only-export-components` allow-list.
//
// Companion to `ui/toast.tsx`. The original exported `useToast` (a hook
// reading from a module-private `ToastContext`). The hook and the context
// it depends on moved here, along with the type interfaces (`Toast`,
// `ToastContextType`) and the `ToastType` union that the styled components
// (`ToastIcon`, etc.) read as a prop type.
//
// Consumers update:
//   - `<ToastProvider>` from `@/components/ui/toast` (unchanged)
//   - `useToast`, `Toast` / `ToastContextType` / `ToastType` types
//     from `@/components/ui/toast.helpers`
// ──────────────────────────────────────────────────────────────────────────

import * as React from 'react'

export type ToastType = 'default' | 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
}

export interface ToastContextType {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType) => void
  removeToast: (id: string) => void
}

export const ToastContext = React.createContext<ToastContextType | undefined>(undefined)

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
