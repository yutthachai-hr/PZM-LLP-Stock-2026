import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: 'toast-ux.demo.ts', workers: 1, retries: 0,
  timeout: 45_000, expect: { timeout: 8000 }, outputDir: 'e2e-results/toast-ux',
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5189', timezoneId: 'Asia/Bangkok', trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --mode demo --host 127.0.0.1 --port 5189 --strictPort', url: 'http://127.0.0.1:5189/e2e/toast-harness.html', reuseExistingServer: !process.env.CI },
})
