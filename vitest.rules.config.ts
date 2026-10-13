import { defineConfig } from 'vitest/config'

// Rules tests, and the few tests that need a real Firestore (`*.emulator.test.ts`). They share
// one emulator project/database, so they run in a single worker and in file order to keep one
// file's seed data out of another's assertions.
export default defineConfig({
  test: {
    include: ['tests/**/*rules*.test.ts', 'tests/**/*.emulator.test.ts'],
    fileParallelism: false,
  },
})
