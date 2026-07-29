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
// autoCodeSplitting stays false: TanStack staggered releases still risk
// TSRSplitComponent runtime gaps (ticket 07). Route-level splitting is
// provided by `lazyPage()` in app/routes/* instead — same outcome, safe.
// See docs/dev/second-batch-tickets/07-tanstack-version-align-codesplit.md.
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
    // Modern browsers only — smaller syntax transform output.
    target: 'es2022',
    cssCodeSplit: true,
    // Skip gzip size reporting in CI/dev builds (faster).
    reportCompressedSize: false,
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Keep React + router together so they share one stable cache entry.
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/scheduler') ||
            id.includes('node_modules/@tanstack/react-router') ||
            id.includes('node_modules/@tanstack/router-core') ||
            id.includes('node_modules/@tanstack/history')
          ) {
            return 'vendor-react'
          }
          if (
            id.includes('node_modules/@tanstack/react-query') ||
            id.includes('node_modules/@tanstack/query-core')
          ) {
            return 'vendor-query'
          }
          if (id.includes('node_modules/axios')) {
            return 'vendor-axios'
          }
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) {
            return 'vendor-i18n'
          }
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) {
            return 'vendor-motion'
          }
          // Marketing / landing ambient motion — not needed on most dashboard routes.
          if (
            id.includes('node_modules/gsap') ||
            id.includes('node_modules/@gsap/')
          ) {
            return 'vendor-gsap'
          }
          // Analytics charts — heavy d3 surface, only Analytics pages.
          if (
            id.includes('node_modules/recharts') ||
            id.includes('node_modules/victory-vendor') ||
            id.includes('/node_modules/d3-') ||
            id.includes('\\node_modules\\d3-')
          ) {
            return 'vendor-recharts'
          }
          // Calendar page only.
          if (
            id.includes('node_modules/react-big-calendar') ||
            id.includes('node_modules/@restart')
          ) {
            return 'vendor-calendar'
          }
          // AI chat surface — large, route-scoped.
          if (id.includes('node_modules/@assistant-ui')) {
            return 'vendor-assistant'
          }
          // Markdown stack (AI / docs surfaces).
          if (
            id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/remark-') ||
            id.includes('node_modules/mdast-') ||
            id.includes('node_modules/micromark') ||
            id.includes('node_modules/unified') ||
            id.includes('node_modules/hast-')
          ) {
            return 'vendor-markdown'
          }
        },
      },
    },
  },
})
