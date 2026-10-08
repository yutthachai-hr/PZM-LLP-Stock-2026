// G21 — mutation testing, run before a release (npm run mutation), not on every commit.
// Scope: the modules that decide what is safe — the guard, the concurrency check, the
// workflow machines, supplier resolution and the trace allow-list. A surviving mutant is a
// change to one of them that no test notices.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts', related: false },
  mutate: [
    'src/agent/guard.ts',
    'src/lib/concurrency.ts',
    'src/lib/workflow.ts',
    'src/lib/supplierResolution.ts',
    'src/lib/trace.ts',
  ],
  // Off: see vitest.mutation.config.ts for why per-test filtering is not used here.
  coverageAnalysis: 'off',
  concurrency: 4,
  timeoutMS: 30000,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 85, low: 70, break: 60 },
  tempDirName: '.stryker-tmp',
}
