import { backend } from '../backend'
import { COL, type StockLocation, type LocationType } from '../types'

export async function createLocation(name: string, type: LocationType): Promise<string> {
  return backend.add(COL.locations, {
    name: name.trim(),
    type,
    active: true,
    createdAt: Date.now(),
  })
}

export async function updateLocation(
  id: string,
  patch: Partial<Pick<StockLocation, 'name' | 'type' | 'active'>>,
): Promise<void> {
  await backend.update(COL.locations, id, patch as Record<string, unknown>)
}

export async function deleteLocation(id: string): Promise<void> {
  const levels = await backend.getAll<{ id: string; locationId: string }>(COL.stockLevels)
  await Promise.all(
    levels.filter((l) => l.locationId === id).map((l) => backend.remove(COL.stockLevels, l.id)),
  )
  await backend.remove(COL.locations, id)
}
