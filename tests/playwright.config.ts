import { defineConfig } from '@playwright/test'

/**
 * OPT-3F-e2e: Playwright config for the three manual-flow specs that
 * cover PR-OPT-3F (AI sidebar collapse + LS persistence), PR-OPT-3G
 * (chip-driven controlled-Accordion + platform ring), and PR-OPT-3I
 * (cancellable 4 s post-submit auto-navigate).
 *
 * Conventions:
 *   - Web Shell is assumed to already be running at `baseURL`. Run
 *     `bash sau_web/start.sh` in another terminal before `pnpm e2e`.
 *     If you want Playwright to boot it itself, flip `useExternalServer`
 *     to `false` below and let the `webServer` block take over.
 *   - Specs rely on `page.route('/api/**', …)` to mock backend
 *     responses, so no real DB / cookies are required. The backend
 *     itself may stay dark; tests don't make real network calls to it.
 *   - Only Chromium is configured — the Web Shell is exercised
 *     against the channel that matches what most CI images ship.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'line' : 'list',

  use: {
    // Post-merge the SPA serves both marketing + dashboard from
    // :5180; :5174 has no Vite listener after `sau_web/site/` was
    // removed. Every spec in `tests/e2e/` also carries an explicit
    // `test.use({ baseURL: 'http://localhost:5180' })` override so
    // the port is self-evident per file (not just chases here).
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Stable viewport for the desktop flow we exercise (publish page
    // only renders both columns at >= lg = 1024 px).
    viewport: { width: 1280, height: 800 },
  },

  // External Web Shell server assumed to be running. Override with
  // `E2E_BOOT_SERVER=1` to let Playwright manage the lifecycle (CI
  // usually wants this; local dev already has the shell in another
  // terminal so external is faster).
  webServer: process.env['E2E_BOOT_SERVER']
    ? {
        // Playwright resolves webServer.command relative to the config
        // file's directory (tests/), NOT the shell's cwd at invocation
        // time. From tests/ the relative path to sau_web/start.sh is
        // one level up, not two — `../../sau_web/start.sh` would 404
        // out of the repo root. Use the cwd-relative form here.
        command: 'bash ../sau_web/start.sh',
        // Post-merge the SPA serves both marketing + dashboard from
        // :5180; :5174 has no Vite after sau_web/site/ was removed.
        url: 'http://localhost:5180',
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
        // Inject env vars that the Flask backend needs for E2E tests.
        // SAU_MOCK_AUTHORIZE=true makes the backend generate synthetic
        // QR codes so the opt-3m drag-proof test can exercise the full
        // SSE authorize flow without real platform credentials.
        // DATABASE_URL points at a local Postgres test database; tests
        // that don't actually exercise the DB route can ignore it.
        // Post-SQLite-removal: the prior SAU_DB_DIALECT=sqlite override
        // is gone — PG is the only backend now.
        env: {
          SAU_MOCK_AUTHORIZE: 'true',
          DATABASE_URL: process.env['DATABASE_URL'] || 'postgres://sau:sau@localhost:5432/sau_test',
        },
      }
    : undefined,

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
