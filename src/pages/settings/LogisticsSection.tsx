import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { classifyProfileError } from '../../auth/profileError'
import { BRANDS, type BrandId } from '../../brand/brand'
import { backend } from '../../backend'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, SectionHeader } from '../../components/ui'
import { AppError, errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { ensureTransitLocation } from '../../services/transfers'
import { COL, TRANSIT_LOCATION_ID, type StockLocation } from '../../types'

/**
 * What the transit document of one company says. `wrongType` is a document at the transit id
 * that is not a transit location; `denied` and `unknown` are reads that failed, so the state
 * is not known and the switch is not offered.
 */
type Status = 'loading' | 'on' | 'off' | 'wrongType' | 'denied' | 'unknown'

export async function statusOf(brand: BrandId): Promise<Status> {
  try {
    const loc = await backend.forBrand(brand).getOne<StockLocation>(COL.locations, TRANSIT_LOCATION_ID)
    return !loc ? 'off' : loc.type === 'transit' ? 'on' : 'wrongType'
  } catch (e) {
    return classifyProfileError(e) === 'denied' ? 'denied' : 'unknown'
  }
}

/**
 * ระบบส่งสินค้า — switched on per company by creating its "in transit" location. Until then
 * a request can be written and submitted, but approving one refuses: there is nowhere for the
 * goods to be while they are on the road. Locations are an admin's to create.
 */
export function LogisticsSection() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const [status, setStatus] = useState<Record<BrandId, Status>>({ pizza: 'loading', lelapin: 'loading', rnd: 'loading' })
  const [busy, setBusy] = useState(false)

  async function check(brand: BrandId): Promise<Status> {
    setStatus((s) => ({ ...s, [brand]: 'loading' }))
    const next = await statusOf(brand)
    setStatus((s) => ({ ...s, [brand]: next }))
    return next
  }

  useEffect(() => {
    for (const b of BRANDS) void check(b.id)
  }, [])

  async function enable(brand: BrandId, name: string) {
    if (!user) return
    setBusy(true)
    try {
      await ensureTransitLocation(brand, user)
      // Success is what the database now holds, not that the write returned.
      if ((await check(brand)) === 'on') toast.success(t('เปิดใช้ระบบส่งสินค้าแล้ว'))
      else toast.error(t('{brand}: เปิดใช้ระบบส่งสินค้าไม่สำเร็จ ตรวจสอบสถานะไม่ผ่าน', { brand: name }))
    } catch (e) {
      // No retry: a refused write stays refused until someone changes the rules or the role.
      const why =
        e instanceof AppError ? errText(e, t)
        : classifyProfileError(e) === 'denied' ? t('ไม่มีสิทธิ์สร้างคลังระหว่างขนส่ง')
        : t('เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง')
      toast.error(t('{brand}: เปิดใช้ระบบส่งสินค้าไม่สำเร็จ — {why}', { brand: name, why }))
      void check(brand)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="truck"
        title={t('ระบบส่งสินค้า')}
        description={t('สร้างคลัง "ระหว่างขนส่ง" ของแต่ละบริษัท ก่อนอนุมัติการโอนครั้งแรก')}
      />
      <div className="divide-y divide-line">
        {BRANDS.map((b) => {
          const s = status[b.id]
          return (
            <div key={b.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1 font-medium">{b.name}</div>
              {s === 'loading' ? (
                <span className="text-sm text-ink-faint">{t('กำลังโหลด...')}</span>
              ) : s === 'on' ? (
                <Badge color="green">{t('เปิดใช้แล้ว')}</Badge>
              ) : s === 'off' ? (
                <Button size="sm" disabled={busy} onClick={() => void enable(b.id, b.name)}>
                  {t('เปิดใช้ระบบส่งสินค้า')}
                </Button>
              ) : s === 'wrongType' ? (
                <Badge color="amber">{t('ข้อมูลคลังระหว่างขนส่งไม่ถูกต้อง')}</Badge>
              ) : (
                <>
                  <Badge color="red">{s === 'denied' ? t('ไม่มีสิทธิ์อ่านสถานะ') : t('ตรวจสอบสถานะไม่ได้')}</Badge>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void check(b.id)}>
                    {t('ลองอีกครั้ง')}
                  </Button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
