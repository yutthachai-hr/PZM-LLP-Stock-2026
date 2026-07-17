// Firebase configuration.
//
// The app runs in LOCAL mode (data on this device) until a valid config is provided.
// Add cloud sync in ONE of two ways:
//   1. Paste your config in the app: Settings → เชื่อมต่อ Cloud (saved to this browser only), OR
//   2. Hardcode it below in BUILT_IN so every deployment uses it.
//
// Get these values free from https://console.firebase.google.com
//   → create project (Spark/free plan) → Web app → "Firebase SDK snippet" → Config.

export interface FirebaseConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket?: string
  messagingSenderId?: string
  appId: string
}

// Optional: hardcode here to ship cloud mode to everyone. Leave null to configure in-app.
// Firebase web config is safe to embed in client code (protected by Firestore rules +
// authorized domains). This makes EVERY device open in Cloud mode automatically.
const BUILT_IN: FirebaseConfig | null = {
  apiKey: 'AIzaSyB2cQL0G-OLibdoe5HPAhTJhmHnmLQCLlo',
  authDomain: 'pzm-stock-x5.firebaseapp.com',
  projectId: 'pzm-stock-x5',
  storageBucket: 'pzm-stock-x5.firebasestorage.app',
  messagingSenderId: '789071579161',
  appId: '1:789071579161:web:58df8f34e911cd7218c288',
}

const LS_KEY = 'pmstock:firebaseConfig'

function isValid(c: unknown): c is FirebaseConfig {
  const o = c as Partial<FirebaseConfig>
  return !!(o && o.apiKey && o.projectId && o.appId && o.authDomain)
}

export function getFirebaseConfig(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (isValid(parsed)) return parsed
    }
  } catch {
    /* ignore */
  }
  return BUILT_IN && isValid(BUILT_IN) ? BUILT_IN : null
}

export function saveFirebaseConfig(c: FirebaseConfig): void {
  localStorage.setItem(LS_KEY, JSON.stringify(c))
}

export function clearFirebaseConfig(): void {
  localStorage.removeItem(LS_KEY)
}

export function firebaseReady(): boolean {
  return getFirebaseConfig() !== null
}

/** Best-effort parse of a pasted Firebase config (accepts JSON or a JS object literal snippet). */
export function parseConfigInput(input: string): FirebaseConfig | null {
  const text = input.trim()
  if (!text) return null
  // Try strict JSON first
  try {
    const j = JSON.parse(text)
    if (isValid(j)) return j
  } catch {
    /* fall through */
  }
  // Try to extract the { ... } object from a JS snippet like `const firebaseConfig = { ... };`
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      // Normalise: quote unquoted keys, convert single to double quotes, drop trailing commas.
      let body = match[0]
        .replace(/([,{]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"')
        .replace(/,(\s*[}\]])/g, '$1')
      const j = JSON.parse(body)
      if (isValid(j)) return j
    } catch {
      /* ignore */
    }
  }
  return null
}
