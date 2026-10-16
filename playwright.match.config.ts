import { defineConfig, devices } from '@playwright/test'

/** Product matching against the real app in demo mode: browser storage only, no emulator ports, no live data. */
export default defineConfig({
  testDir: './e2e', testMatch: 'product-match.demo.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 10_000 }, outputDir: 'e2e-results/product-match', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5191', locale: 'th-TH', timezoneId: 'Asia/Bangkok', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite --mode demo --host 127.0.0.1 --port 5191 --strictPort', url: 'http://127.0.0.1:5191', reuseExistingServer: !process.env.CI },
})
