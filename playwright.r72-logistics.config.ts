import { defineConfig, devices } from '@playwright/test'

/**
 * R72 Agent07 dedicated E2E & visual invariants configuration.
 * Leased port: 5217 ONLY.
 * Mode: demo (pure browser localStorage pmstock:v1, no Firestore/Auth emulators on 8080/9099/5176).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'r72-logistics-ux.demo.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'e2e-results/r72-logistics',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5217',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: { mode: 'on', fullPage: true },
  },
  webServer: {
    command: 'npx vite --mode demo --host 127.0.0.1 --port 5217 --strictPort',
    url: 'http://127.0.0.1:5217',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
