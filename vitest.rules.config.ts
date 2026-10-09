import { defineConfig } from 'vitest/config'

// Rules tests only. They share one emulator project/database, so they run in a single
// worker and in file order to keep one file's seed data out of another's assertions.
export default defineConfig({
  test: {
    include: ['tests/**/*rules*.test.ts'],
    fileParallelism: false,
    // Time limit, not a retry: the budget tests write 500-entry documents through the
    // emulator and take a steady 4.4–5.0 s (measured 7 Oct 2026), right at vitest's 5 s
    // default, which failed one run at 5.09 s. A real hang still fails, after 30 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
