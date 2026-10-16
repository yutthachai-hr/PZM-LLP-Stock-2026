import { defineConfig, devices } from '@playwright/test'

/** Global search against the real app in demo mode: browser storage only, no emulator ports, no live data. */
export default defineConfig({
  testDir: './e2e', testMatch: 'global-search.demo.ts', workers: 1, retries: 0,
  timeout: 45_000, expect: { timeout: 10_000 }, outputDir: 'e2e-results/global-search', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5190', locale: 'th-TH', timezoneId: 'Asia/Bangkok', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite --mode demo --host 127.0.0.1 --port 5190 --strictPort', url: 'http://127.0.0.1:5190', reuseExistingServer: !process.env.CI },
})
