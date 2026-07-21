import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite as TanStackRouter } from '@tanstack/router-vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import path from 'path'
import type { IncomingMessage } from 'http'

export default defineConfig({
  plugins: [
    // TanStack Router plugin must point to app/ routes + routeTree.gen
    TanStackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './app/routes',
      generatedRouteTree: './app/routeTree.gen.ts',
    }),
    // TanStack Start plugin defaults to src/; project uses app/
    tanstackStart({ srcDirectory: 'app' }),
    // FIX-B ticket-07 partial workaround (2026-07-21):
    // `react({ fastRefresh: false })` disables React Fast Refresh's HMR
    // boundary injection (`const hot = import.meta.hot.accept(...)` at
    // module scope top). This resolves the persistent
    // `tanstack-router:code-splitter:compile-reference-file` `Duplicate
    // declaration "hot"` Babel scope-collision error (verified 2026-07-21):
    // when `autoCodeSplitting: false`, `routerHmr` (the dev-only HMR
    // sub-plugin of @tanstack/router-plugin) STILL UNCONDITIONALLY
    // injects its own `const hot = ...` at module scope, colliding with
    // React Fast Refresh's identical-name block-scoped declaration.
    // Trade-off: lose component-level HMR (full file reload on save
    // instead) until ticket 07's plugin-version alignment is resolved.
    // Restoration TODO: re-enable `react()` once
    // `npm i @tanstack/router-vite-plugin@<matched>` aligns versions
    // with @tanstack/react-router's AST expectations.
    react({ fastRefresh: false }),
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
          // SSE requires unbuffered proxy responses (login QR, upload progress, AI streaming)
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
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/motion')) {
            return 'vendor-motion';
          }
        },
      },
    },
  },
})
