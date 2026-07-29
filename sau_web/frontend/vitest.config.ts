import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Web Shell core tests — multi-platform upload shell (accounts / publish / tasks / logs / AI panel).
 * SaaS marketing, admin RBAC, studio, and unfinished wizard suites restored from history
 * are excluded until those features are fully re-wired.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: [
      'src/lib/**/*.test.ts',
      'src/lib/chat/**/*.test.tsx',
      'src/stores/**/*.test.tsx',
      'src/pages/**/*.test.tsx',
      'src/components/AiPanel/**/*.test.tsx',
      'src/features/accounts/AccountsProvider.test.tsx',
      'src/features/accounts/SortableAuthorizationItem.test.tsx',
      'src/features/accounts/dialogs/AuthorizeDialog.test.tsx',
      'src/features/publish/NoteForm.test.tsx',
      'src/features/publish/VideoForm.test.tsx',
      'src/features/tasks/TaskDrawer.test.tsx',
      'src/features/tasks/TaskTableRow.test.tsx',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/**/*.e2e.*',
    ],
    server: {
      deps: {
        inline: [/motion/, /@radix-ui/],
      },
    },
  },
})
