import base from './playwright.config'

/**
 * Release gate — flakiness runs (owner, 6 Oct 2026: "Do not hide flakiness with blind
 * retries"). The normal config, with:
 *   - retries pinned to 0, so every failure counts;
 *   - every failure keeps its trace (console + network + DOM snapshots), screenshot and video;
 *   - the JSON report of every attempt with its timing, per run label.
 *
 *   FLAKY_LABEL=live-error-x20 npx playwright test -c playwright.flaky.config.ts live-error --repeat-each=20
 *
 * PW_CHROMIUM points at a preinstalled browser where Playwright's own is not downloaded.
 */
const label = process.env.FLAKY_LABEL ?? 'run'
const exe = process.env.PW_CHROMIUM

export default {
  ...base,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: `e2e-results/flaky/${label}.json` }]],
  outputDir: `e2e-results/flaky/${label}`,
  use: {
    ...base.use,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(exe ? { launchOptions: { executablePath: exe } } : {}),
  },
}
