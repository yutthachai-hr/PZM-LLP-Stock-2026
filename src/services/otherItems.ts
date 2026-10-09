import { BACKEND_MODE } from '../backend'
import { getBrand } from '../brand/brand'
import { proposeItemCommand, type ProposeItemParams, type ProposeItemResult } from '../commands/proposeItem'
import { AppError } from '../i18n/AppError'
import type { ProductAlias } from '../lib/productMatch'
import { listAliases } from './productAliases'
import { callCommand, execute, NOT_SENT } from './stock'
import type { Actor } from '../commands/ledgerTx'

/**
 * Smart "Other" item (R&D): propose a new product from a request. In the cloud it always
 * runs on the server — products are admin-only under the rules, and the server is what
 * allocates the code atomically. In local / demo mode the same command runs on the device.
 */
export async function proposeItem(params: ProposeItemParams, actor: Actor): Promise<ProposeItemResult> {
  if (BACKEND_MODE !== 'cloud') return execute(proposeItemCommand, params, actor)
  const r = await callCommand<ProposeItemResult>(proposeItemCommand.name, params, getBrand(), { force: true })
  if (r === NOT_SENT) throw new AppError('สร้างรายการใหม่ไม่ได้ในตอนนี้ — ระบบฝั่งเซิร์ฟเวอร์ยังไม่พร้อม ลองใหม่ภายหลัง หรือแจ้งผู้ดูแล')
  return r
}

/** The brand's confirmed spellings, read once a session (typing never reads). */
const aliasCache = new Map<string, Promise<ProductAlias[]>>()
export function aliasesOnce(): Promise<ProductAlias[]> {
  const brand = getBrand()
  let p = aliasCache.get(brand)
  if (!p) {
    p = listAliases().catch(() => [])
    aliasCache.set(brand, p)
  }
  return p
}
