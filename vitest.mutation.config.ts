import { defineConfig } from 'vitest/config'

// G21: the tests Stryker runs against each mutant (npm run mutation) — the suites that pin the
// mutated modules (stryker.config.mjs `mutate`). Coverage analysis is off in Stryker: on a path
// with a space, its per-test filtering ran zero tests per mutant and reported every mutant as
// surviving (7 Oct run, testsCompleted 0). Running this small set whole is slower but honest.
export default defineConfig({
  test: {
    include: [
      'tests/agent-guard.test.ts',
      'tests/agent-proposal.test.ts',
      'tests/agent-dataset.test.ts',
      'tests/concurrency.test.ts',
      'tests/workflow.test.ts',
      'tests/supplier-resolution.test.ts',
      'tests/functions/trace-e2e.test.ts',
      'tests/purchase-orders.test.ts',
      'tests/audit-log.test.ts',
    ],
  },
})
