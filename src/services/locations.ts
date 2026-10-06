import { backend } from '../backend'
import { bumpCacheEpoch } from './cacheEpoch'
import { DELETE_FIELD } from '../backend/types'
import { AppError } from '../i18n/AppError'
import { COL, type StockLocation, type LocationType } from '../types'

export async function createLocation(name: string, type: LocationType, nameEn?: string): Promise<string> {
  return backend.add(COL.locations, {
    name: name.trim(),
    ...(nameEn?.trim() ? { nameEn: nameEn.trim() } : {}),
    type,
    active: true,
    createdAt: Date.now(),
  })
}

export async function updateLocation(
  id: string,
  patch: Partial<Pick<StockLocation, 'name' | 'nameEn' | 'type' | 'active'>>,
): Promise<void> {
  const next: Record<string, unknown> = { ...patch }
  // An empty English name removes the key: the validator pins the shape with hasOnly, and
  // a blank label would show as nothing where the Thai name should stand in.
  if ('nameEn' in patch) next.nameEn = patch.nameEn?.trim() ? patch.nameEn.trim() : DELETE_FIELD
  await backend.update(COL.locations, id, next)
}

async function deleteLocationUnbumped(id: string): Promise<void> {
  // A location with history is switched off, never deleted (plan B3): its balances are what
  // its rows add up to, and removing them strands the stock.
  const into = await backend.getBy<{ id: string }>(COL.movements, 'toLocationId', id)
  const outOf = into.length ? [] : await backend.getBy<{ id: string }>(COL.movements, 'fromLocationId', id)
  if (into.length || outOf.length) throw new AppError('คลังนี้มีประวัติการเคลื่อนไหวแล้ว — ลบไม่ได้ ให้ปิดใช้งานแทน')
  const levels = await backend.getAll<{ id: string; locationId: string }>(COL.stockLevels)
  await Promise.all(
    levels.filter((l) => l.locationId === id).map((l) => backend.remove(COL.stockLevels, l.id)),
  )
  await backend.remove(COL.locations, id)
}

/** deleteLocation, then the devices' caches told to read again (release hardening: services/cacheEpoch). */
export async function deleteLocation(...args: Parameters<typeof deleteLocationUnbumped>): ReturnType<typeof deleteLocationUnbumped> {
  const result = await deleteLocationUnbumped(...args)
  await bumpCacheEpoch(['stockLevels'])
  return result
}
