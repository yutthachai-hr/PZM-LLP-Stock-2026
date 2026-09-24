import { useCallback, useEffect, useState } from 'react'
import { backend } from '../backend'
import { brandDef, type BrandId } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { COL, type CompanyProfile } from '../types'
import { cleanPrefix } from './sequence'

/**
 * The company as its documents present it — the die-cut logo and the document prefix —
 * one document per brand, `companyProfile/main`, written by an admin in Settings.
 *
 * Nothing about a logo is hard-coded in a template: the announcement sheet reads this, and
 * a brand with no logo uploaded yet prints its name instead. A logo is stored the way
 * product photos are (a data URL in Firestore) because the free plan has no Storage.
 */

export const PROFILE_ID = 'main'
/** A logo document is capped by the rules; a data URL this long is ~600 KB of image. */
export const LOGO_MAX_CHARS = 800_000

export function defaultProfile(brand: BrandId): CompanyProfile {
  return { id: PROFILE_ID, docPrefix: brandDef(brand).sheetKey, announcementCode: 'ANN' }
}

/** Read with defaults filled in, so a brand nobody has set up still numbers its documents. */
export async function getCompanyProfile(brand: BrandId): Promise<CompanyProfile> {
  const stored = await backend.forBrand(brand).getOne<CompanyProfile>(COL.companyProfile, PROFILE_ID)
  return withDefaults(brand, stored)
}

export function withDefaults(brand: BrandId, stored: Partial<CompanyProfile> | null): CompanyProfile {
  const base = defaultProfile(brand)
  return {
    ...base,
    ...(stored ?? {}),
    id: PROFILE_ID,
    docPrefix: cleanPrefix(stored?.docPrefix, base.docPrefix),
    announcementCode: cleanPrefix(stored?.announcementCode, base.announcementCode),
  }
}

/** The name documents print for this company. */
export function companyName(brand: BrandId, profile: Pick<CompanyProfile, 'displayName'> | null): string {
  return profile?.displayName?.trim() || brandDef(brand).name
}

export async function saveCompanyProfile(
  brand: BrandId,
  patch: {
    docPrefix: string
    announcementCode: string
    displayName?: string
    nameEn?: string
    /** undefined = leave the logo alone, null = remove it. */
    logoDataUrl?: string | null
  },
  actor: { id: string; role: string },
): Promise<CompanyProfile> {
  if (actor.role !== 'admin') throw new AppError('ต้องเป็นผู้ดูแลระบบ')
  const prefix = cleanPrefix(patch.docPrefix, '')
  const code = cleanPrefix(patch.announcementCode, '')
  if (!prefix || !code) throw new AppError('กรุณากรอกตัวย่อเลขเอกสาร (A-Z หรือ 0-9)')
  if (typeof patch.logoDataUrl === 'string') {
    if (!/^data:image\/(png|jpeg);base64,/.test(patch.logoDataUrl)) throw new AppError('ไฟล์โลโก้ต้องเป็น PNG หรือ JPG')
    if (patch.logoDataUrl.length > LOGO_MAX_CHARS) throw new AppError('โลโก้ใหญ่เกินไป')
  }
  const db = backend.forBrand(brand)
  const cur = await db.getOne<CompanyProfile>(COL.companyProfile, PROFILE_ID)
  const logoChanged = patch.logoDataUrl !== undefined && patch.logoDataUrl !== (cur?.logoDataUrl ?? null)
  const logo = patch.logoDataUrl === undefined ? cur?.logoDataUrl : (patch.logoDataUrl ?? undefined)
  const next: CompanyProfile = {
    id: PROFILE_ID,
    docPrefix: prefix,
    announcementCode: code,
    ...(patch.displayName?.trim() ? { displayName: patch.displayName.trim() } : {}),
    ...(patch.nameEn?.trim() ? { nameEn: patch.nameEn.trim() } : {}),
    ...(logo ? { logoDataUrl: logo } : {}),
    logoVersion: (cur?.logoVersion ?? 0) + (logoChanged ? 1 : 0),
    updatedBy: actor.id,
    updatedAt: Date.now(),
  }
  const { id, ...data } = next
  await db.set(COL.companyProfile, id, data)
  return next
}

/** One read when a screen that prints the company opens; nothing is subscribed. */
export function useCompanyProfile(brand: BrandId): {
  profile: CompanyProfile
  loaded: boolean
  reload: () => void
} {
  const [state, setState] = useState<{ brand: BrandId; profile: CompanyProfile; loaded: boolean }>(() => ({
    brand,
    profile: defaultProfile(brand),
    loaded: false,
  }))
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    getCompanyProfile(brand)
      .then((profile) => live && setState({ brand, profile, loaded: true }))
      .catch(() => live && setState({ brand, profile: defaultProfile(brand), loaded: true }))
    return () => {
      live = false
    }
  }, [brand, tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  const current = state.brand === brand ? state : { profile: defaultProfile(brand), loaded: false }
  return { profile: current.profile, loaded: current.loaded, reload }
}
