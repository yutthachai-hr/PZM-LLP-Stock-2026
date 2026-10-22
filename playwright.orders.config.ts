import { defineConfig, devices } from '@playwright/test'

/** Isolated browser-storage demo: no shared emulator ports and no production credentials. */
export default defineConfig({
  testDir: './e2e', testMatch: /orders-(ux|line-status)\.demo\.ts$/, workers: 1, retries: 0,
  timeout: 45_000, expect: { timeout: 10_000 },
  outputDir: 'e2e-results/orders-ux', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5187', locale: 'th-TH', timezoneId: 'Asia/Bangkok', trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --mode demo --host 127.0.0.1 --port 5187 --strictPort', url: 'http://127.0.0.1:5187', reuseExistingServer: !process.env.CI },
})
