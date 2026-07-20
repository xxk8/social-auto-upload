import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'
import { TanStackRouterVite as TanStackRouter } from '@tanstack/router-vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import path from 'path'
import type { IncomingMessage } from 'http'

export default defineConfig({
  plugins: [
    { enforce: 'pre', ...mdx({
      providerImportSource: '@mdx-js/react',
      remarkPlugins: [remarkGfm],
    }) },
    // TanStack Router plugin must point to app/ routes + routeTree.gen
    TanStackRouter({
      target: 'react',
      // autoCodeSplitting: false — when true, the plugin injects a
      // TSRSplitComponent helper into route files for lazy loading, but
      // the helper IS NOT DEFINED at SSR runtime by the installed
      // @tanstack/react-router version, causing `ReferenceError:
      // TSRSplitComponent is not defined` → HTTP 500 on ALL routes.
      // See docs/dev/second-batch-tickets/07-tanstack-version-align-codesplit.md
      // for the full investigation (ticket 07 attempted aligning all
      // packages to 1.167.0 + a higher version but both broke SSR in
      // different ways — see the doc for the deferred outcome).
      // Code splitting is an optimization, not a correctness requirement —
      // static imports load all routes upfront, which is safer.
      autoCodeSplitting: false,
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
    port: 5180,
    open: false,
    // Defense-in-depth: ignore backend write-target `videos/` (where
    // `web_runner/utils.py::INBOX_DIR = BASE_DIR/videos/inbox` saves
    // downloads). Vite's default `server.watch` root is the project
    // root — `sau_web/frontend/` — which does NOT include the repo
    // root's `videos/`, so this rule is a no-op against the current
    // config. Guards against future additions to
    // `server.watch.additionalPaths` (a one-line LATER addition
    // could re-introduce a chokidar event for any `.mp4` written by
    // the inbox download path, triggering a full page reload that
    // aborts the in-flight POST `/api/inbox/download`). Pattern is
    // chokidar-glob relative to vite's cwd (`sau_web/frontend/`),
    // so 2 `../` ascend past `sau_web/` to the repo root.
    watch: {
      ignored: ['**/../../videos/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:6001',
        changeOrigin: true,
        configure: (proxy) => {
          // SSE (text/event-stream) requires unbuffered responses so the
          // browser EventSource can transition from CONNECTING to OPEN.
          // http-proxy checks res.headersSent before writing headers
          // internally — calling res.writeHead() here sets headersSent,
          // http-proxy skips its own write, and still pipes the body.
          proxy.on('proxyRes', (proxyRes: IncomingMessage, _req, res) => {
            proxyRes.headers['cache-control'] = 'no-cache'
            proxyRes.headers['x-accel-buffering'] = 'no'

            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
              res.flushHeaders()
              // http-proxy will still pipe proxyRes -> res body;
              // headersSent is now true so it skips its own writeHead.
            }
          })
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    // The previous PR iteration aliased `react/jsx-runtime` and
    // `react/jsx-dev-runtime` to project-internal absolute paths to
    // work around an MDX-file-at-repo-root resolution failure. That
    // workaround is no longer needed: DESIGN-components.mdx has been
    // moved into `sau_web/frontend/content/`, which sits inside vite's
    // project root and resolves bare specifiers through project-tree
    // `node_modules` natively. The aliases were vestigial the moment
    // the file moved; kept commented-out below for one PR cycle in
    // case the layout regresses. REMOVE before merging the next
    // design-system PR.
    // 'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
    // 'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime'),
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
          if (id.includes('node_modules/@radix-ui/')) {
            return 'vendor-radix';
          }
          if (id.includes('node_modules/@tanstack/react-query')) {
            return 'vendor-query';
          }
          if (id.includes('node_modules/recharts')) {
            return 'vendor-charts';
          }
        },
      },
    },
  },
})
