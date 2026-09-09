import { defineConfig } from 'vitest/config'

// Rules tests only. They share one emulator project/database, so they run in a single
// worker and in file order to keep one file's seed data out of another's assertions.
export default defineConfig({
  test: {
    include: ['tests/**/*rules*.test.ts'],
    fileParallelism: false,
  },
})
