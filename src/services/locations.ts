import { backend } from '../backend'
import { DELETE_FIELD } from '../backend/types'
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

export async function deleteLocation(id: string): Promise<void> {
  const levels = await backend.getAll<{ id: string; locationId: string }>(COL.stockLevels)
  await Promise.all(
    levels.filter((l) => l.locationId === id).map((l) => backend.remove(COL.stockLevels, l.id)),
  )
  await backend.remove(COL.locations, id)
}
