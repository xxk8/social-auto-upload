import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite as TanStackRouter } from '@tanstack/router-vite-plugin'
import path from 'path'
import type { IncomingMessage } from 'http'

// ── Architecture lock (2026-07) ──────────────────────────────────────
// Web Shell frontend = Vite + React + TanStack Router **SPA only**.
// Do NOT add @tanstack/react-start, tanstackStart(), SSR entrypoints,
// or createServerFn. API stays on Python Flask (:6001); this Vite
// process only serves UI and proxies /api in dev.
// Dev: :5174 → proxy /api → Flask. Prod: Flask serves dist/.
// autoCodeSplitting stays false until router-* versions are aligned
// (see docs/dev/second-batch-tickets/07-tanstack-version-align-codesplit.md).
export default defineConfig({
  plugins: [
    TanStackRouter({
      target: 'react',
      autoCodeSplitting: false,
      routesDirectory: './app/routes',
      generatedRouteTree: './app/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5174,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:6001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes: IncomingMessage) => {
            proxyRes.headers['cache-control'] = 'no-cache'
            proxyRes.headers['x-accel-buffering'] = 'no'
          })
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/@tanstack/react-router')
          ) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/motion')) {
            return 'vendor-motion'
          }
        },
      },
    },
  },
})
