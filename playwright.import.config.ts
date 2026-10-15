import { defineConfig, devices } from '@playwright/test'

/** The import window against the real app in demo mode: browser storage only, no emulator ports, no live data. */
export default defineConfig({
  testDir: './e2e', testMatch: 'import-window.demo.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 10_000 }, outputDir: 'e2e-results/import-window', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5192', locale: 'th-TH', timezoneId: 'Asia/Bangkok', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite --mode demo --host 127.0.0.1 --port 5192 --strictPort', url: 'http://127.0.0.1:5192', reuseExistingServer: !process.env.CI },
})
