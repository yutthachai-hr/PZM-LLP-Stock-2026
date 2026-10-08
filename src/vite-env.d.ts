/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * '1' only in demo builds (`npm run demo`, .env.demo). Read through isDemoMode() in
   * src/firebase/config.ts — do not test this string anywhere else.
   */
  readonly VITE_DEMO_MODE?: string
  /** P0 preview isolation: production | preview | local, set by vite.config.ts from CF_PAGES_BRANCH. */
  readonly VITE_DEPLOY_TIER?: string
  /** '1' under `vite --mode e2e`: the Playwright tests' local Firebase emulators (src/firebase/config.ts). */
  readonly VITE_USE_EMULATOR?: string
  /**
   * The LIFF app id for sharing order sheets through the person's own LINE. Public — it
   * ships in client code. Absent: the share button falls back to the phone's share sheet.
   * Read through src/share/config.ts.
   */
  readonly VITE_LIFF_ID?: string
  /**
   * Where order-sheet pictures are hosted for LINE to fetch. Defaults to this site's own
   * Pages Function (`/api/po-image`). Read through src/services/poImages.ts.
   */
  readonly VITE_PO_IMAGE_HOST?: string
  /**
   * Demo builds only: the header value the image host accepts in place of a Firebase
   * token, because a demo has no Firebase user. Never set on production.
   */
  readonly VITE_PO_IMAGE_DEMO_KEY?: string
  /**
   * Stock commands the app sends to the server instead of writing itself (ADR-001), comma
   * separated, e.g. `receivePO`. Unset = every write stays on the client path. Rolling one
   * back is removing it and redeploying — possible only until the rules close client stock
   * writes for good (Phase A-sec's last step).
   */
  readonly VITE_STOCK_COMMANDS?: string
}
