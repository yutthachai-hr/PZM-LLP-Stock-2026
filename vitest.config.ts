import { defineConfig } from 'vitest/config'

// `npm test` runs the plain unit tests. The rules tests and `*.emulator.test.ts` are excluded
// because they need a running Firestore emulator (and therefore Java) — `npm run test:rules`
// starts one for them.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*rules*.test.ts', 'tests/**/*.emulator.test.ts', 'node_modules/**'],
  },
})
