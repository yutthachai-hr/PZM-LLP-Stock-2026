import { defineConfig, devices } from '@playwright/test'

/** PO send flow (prepare → share → verify), demo mode, browser storage only. Port 5205. CI runs Chromium projects; WebKit needs its browser installed. */
export default defineConfig({
  testDir: './e2e', testMatch: 'line-send.demo.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 10_000 }, outputDir: 'e2e-results/line-send', reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5205', locale: 'th-TH', timezoneId: 'Asia/Bangkok', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  // Emulated only: a phone's real share sheet and LINE app are recorded separately by hand.
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'ipad-webkit', use: { ...devices['iPad (gen 7)'] } },
  ],
  webServer: { command: 'npx vite --mode demo --host 127.0.0.1 --port 5205 --strictPort', url: 'http://127.0.0.1:5205', reuseExistingServer: false },
})
