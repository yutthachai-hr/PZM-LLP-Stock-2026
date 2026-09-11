/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * '1' only in demo builds (`npm run demo`, .env.demo). Read through isDemoMode() in
   * src/firebase/config.ts — do not test this string anywhere else.
   */
  readonly VITE_DEMO_MODE?: string
}
