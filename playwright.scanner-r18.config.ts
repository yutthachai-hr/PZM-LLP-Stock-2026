import { defineConfig, devices } from '@playwright/test'

/**
 * Portable, committed companion to the untracked playwright.scanner.config.ts: same local demo
 * server and one worker, but it runs the committed copy e2e/scanner-sim.r18.spec.ts, whose
 * artifacts go through Playwright's outputPath instead of a private evidence directory.
 *
 * Standalone software evidence only — not remote CI, not emulator-backed, and no physical
 * scanner is exercised.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['scanner-sim.r18.spec.ts', 'scanner-sim.r19.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'e2e-results/scanner-sim-r18',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5196',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --mode demo --host 127.0.0.1 --port 5196 --strictPort',
    url: 'http://127.0.0.1:5196',
    reuseExistingServer: false,
  },
})
