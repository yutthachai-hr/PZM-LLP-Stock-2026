import { defineConfig, devices } from '@playwright/test'

/**
 * Stock buckets on a browser-storage demo: no emulator, no live data, port 5201 (PR49 lease).
 * Proves what a person actually sees for stock the company owns at a closed site, at a second
 * transit location, on a hidden product, and while a balance in transit is negative.
 */
export default defineConfig({
  testDir: './e2e', testMatch: 'stock-transit.demo.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 10_000 }, outputDir: 'e2e-results/stock-transit', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5201', locale: 'en-GB', timezoneId: 'Asia/Bangkok', trace: 'retain-on-failure', screenshot: { mode: 'on', fullPage: true } },
  webServer: { command: 'npx vite --mode demo --host 127.0.0.1 --port 5201 --strictPort', url: 'http://127.0.0.1:5201', reuseExistingServer: false },
})
