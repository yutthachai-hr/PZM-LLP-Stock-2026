import { lineLiffProvider } from './lineLiffProvider'
import { webShareProvider } from './webShareProvider'
import type { PurchaseShareProvider } from './PurchaseShareProvider'

export type { PurchaseShareProvider, SharePayload, ShareOutcome } from './PurchaseShareProvider'
export { statusFor } from './PurchaseShareProvider'

/**
 * The provider this device should use: LINE through LIFF when the deployment has a LIFF
 * id and the SDK reports the picker usable, otherwise the share sheet.
 */
export async function pickShareProvider(): Promise<PurchaseShareProvider> {
  if (await lineLiffProvider.isAvailable()) return lineLiffProvider
  return webShareProvider
}
