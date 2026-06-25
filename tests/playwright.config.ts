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
    baseURL: 'http://localhost:5174',
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
        command: 'bash ../../sau_web/start.sh',
        url: 'http://localhost:5174',
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      }
    : undefined,

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
