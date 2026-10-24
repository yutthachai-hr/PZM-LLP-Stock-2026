import { defineConfig, devices } from '@playwright/test'

// Synthetic browser storage only; no Firebase/LINE/API writes. Port 5206, one server at a time.
export default defineConfig({
  testDir: './e2e', testMatch: 'notification-navigation.demo.ts', workers: 1, retries: 0,
  timeout: 45_000, expect: { timeout: 10_000 }, outputDir: 'e2e-results/notification-navigation',
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5206', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npx vite --mode demo --host 127.0.0.1 --port 5206 --strictPort',
    url: 'http://127.0.0.1:5206', reuseExistingServer: false,
    cwd: process.env.R63_BASE_CHECKOUT || process.cwd(),
  },
})
