import { defineConfig, devices } from '@playwright/test'

/**
 * Products table responsive regression, demo mode: browser storage only, no emulator ports, no
 * live data. Not CI-wired — the demo specs each own their port and are run by name.
 * Port 5198 is the R19-E lease.
 */
export default defineConfig({
  testDir: './e2e', testMatch: 'products-responsive.demo.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 10_000 }, outputDir: 'e2e-results/products-responsive', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5198', locale: 'th-TH', timezoneId: 'Asia/Bangkok', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite --mode demo --host 127.0.0.1 --port 5198 --strictPort', url: 'http://127.0.0.1:5198', reuseExistingServer: !process.env.CI },
})
