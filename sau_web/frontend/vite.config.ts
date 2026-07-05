import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'
import path from 'path'
import type { IncomingMessage } from 'http'

export default defineConfig({
  plugins: [
    { enforce: 'pre', ...mdx({
      providerImportSource: '@mdx-js/react',
      remarkPlugins: [remarkGfm],
    }) },
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5180,
    open: false,
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
