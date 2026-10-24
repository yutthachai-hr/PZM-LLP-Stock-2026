import { defineConfig, devices } from '@playwright/test'

/** Void-with-reason flow in demo mode: browser storage only, no emulator, no live data. Port 5204. */
export default defineConfig({
  testDir: './e2e', testMatch: 'void-reason.demo.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 10_000 }, outputDir: 'e2e-results/void-reason', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5204', locale: 'en-GB', timezoneId: 'Asia/Bangkok', trace: 'retain-on-failure', screenshot: 'on' },
  webServer: { command: 'npx vite --mode demo --host 127.0.0.1 --port 5204 --strictPort', url: 'http://127.0.0.1:5204', reuseExistingServer: false },
})
