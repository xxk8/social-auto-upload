import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // `*.test.ts` is scoped to directories that hold non-React helpers
    // — `src/lib/` (general utilities) and `src/api/` (axios / domain
    // helpers like the 401 response-interceptor). Tests there use
    // plain function bodies (no JSX, no React). Component / hook tests
    // live under `src/` with `.test.tsx`. Restricting `.test.ts` to
    // these known helper domains prevents accidental collection of
    // plain `.test.ts` files under `src/features/` etc., which would
    // route through the React plugin pipeline needlessly.
    //
    // Exception: `src/*.test.ts` (root-only, no recursion) is allowed
    // for the routes.ts single-source-of-truth manifest's unit test
    // (`src/routes.test.ts`). The manifest lives at `src/routes.ts`
    // (not under `src/lib/` because it has no helper-API character —
    // it's a global routing config), so its test is a root sibling.
    // The root-only glob (no `**`) prevents accidental collection
    // of any future `src/features/**/*.test.ts` files that we don't
    // want routed through the React plugin pipeline.
    include: [
      'src/lib/**/*.test.ts',
      'src/api/**/*.test.ts',
      'src/*.test.ts',
      'src/**/*.test.tsx', // `**` covers co-located __tests__/ subdirs — do NOT add a separate __tests__/ glob (would be a strict subset)
    ],
    // jsdom 需要这些 polyfill 来支持常见浏览器 API
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    server: {
      deps: {
        inline: [/motion/, /@radix-ui/],
      },
    },
  },
})
