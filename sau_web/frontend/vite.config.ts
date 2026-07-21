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
