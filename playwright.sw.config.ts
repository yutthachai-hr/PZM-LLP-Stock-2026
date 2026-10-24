import { defineConfig, devices } from '@playwright/test'

/**
 * Service worker page loads on a production-shape demo build, served the way Cloudflare Pages serves it
 * (`.html` → 308), port 5207. Browser storage only: no emulator, no live data, no LINE.
 */
export default defineConfig({
  testDir: './e2e', testMatch: 'sw-navigation.demo.ts', workers: 1, retries: 0,
  timeout: 90_000, expect: { timeout: 15_000 }, outputDir: 'e2e-results/sw-navigation', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5207', serviceWorkers: 'allow', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx vite build --mode demo --outDir dist-sw-e2e && node scripts/pages-static.mjs dist-sw-e2e 5207',
    url: 'http://127.0.0.1:5207', reuseExistingServer: false, timeout: 300_000,
  },
})
