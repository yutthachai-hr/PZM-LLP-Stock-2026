import { defineConfig, devices } from '@playwright/test'

/**
 * R72 Agent05 responsive shared audit and regression suite.
 * Port 5215 demo / local storage only, no emulator ports.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'responsive-shared.demo.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'e2e-results/responsive-shared',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5215',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'on',
  },
  webServer: {
    command: 'npx vite --mode demo --host 127.0.0.1 --port 5215 --strictPort',
    url: 'http://127.0.0.1:5215',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
