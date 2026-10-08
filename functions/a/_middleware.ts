import { previewGuard } from '../_lib/previewGuard'

// P0 preview isolation: every function under /a/ passes through the guard first.
export const onRequest = previewGuard
