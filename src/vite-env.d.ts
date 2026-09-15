/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * '1' only in demo builds (`npm run demo`, .env.demo). Read through isDemoMode() in
   * src/firebase/config.ts — do not test this string anywhere else.
   */
  readonly VITE_DEMO_MODE?: string
  /**
   * The LIFF app id for sharing order sheets through the person's own LINE. Public — it
   * ships in client code. Absent: the share button falls back to the phone's share sheet.
   * Read through src/share/config.ts.
   */
  readonly VITE_LIFF_ID?: string
  /**
   * Where order-sheet pictures are hosted for LINE to fetch. Defaults to this site's own
   * function (`/.netlify/functions/po-image`). Read through src/services/poImages.ts.
   */
  readonly VITE_PO_IMAGE_HOST?: string
  /**
   * Demo builds only: the header value the image host accepts in place of a Firebase
   * token, because a demo has no Firebase user. Never set on production.
   */
  readonly VITE_PO_IMAGE_DEMO_KEY?: string
}
