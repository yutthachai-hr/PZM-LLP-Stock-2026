import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end and concurrency tests (Phase 0 of the Operations OS plan, owner-approved
 * 6 Oct 2026). The app runs in `--mode e2e`, which points it at the local Firebase
 * emulators (project `demo-pzm-e2e`) — never at the live project. Run with
 * `npm run test:e2e`, which starts the emulators around the run.
 *
 * One worker: every scenario reseeds the same emulator database.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'e2e-results/results.json' }]],
  outputDir: 'e2e-results/artifacts',
  use: {
    baseURL: 'http://localhost:5176',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://localhost:5176',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
