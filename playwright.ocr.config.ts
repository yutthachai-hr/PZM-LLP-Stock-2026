import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'ocr-fallback-csp.demo.ts',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  outputDir: 'e2e-results/ocr-fallback',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5194',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-ocr-test.mjs',
    url: 'http://127.0.0.1:5194/e2e/ocr-harness.html',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_PO_IMAGE_DEMO_KEY: 'test-demo-key',
    },
  },
})
