import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { BRANDS, type BrandId } from '../../brand/brand'
import { backend } from '../../backend'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, SectionHeader } from '../../components/ui'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { ensureTransitLocation } from '../../services/transfers'
import { COL, TRANSIT_LOCATION_ID } from '../../types'

/**
 * ระบบส่งสินค้า — switched on per company by creating its "in transit" location. Until then
 * a request can be written and submitted, but approving one refuses: there is nowhere for the
 * goods to be while they are on the road. Locations are an admin's to create.
 */
export function LogisticsSection() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const [on, setOn] = useState<Record<BrandId, boolean | null>>({ pizza: null, lelapin: null })
  const [busy, setBusy] = useState(false)

  async function check() {
    const entries = await Promise.all(
      BRANDS.map(async (b) => [b.id, !!(await backend.forBrand(b.id).getOne(COL.locations, TRANSIT_LOCATION_ID))] as const),
    )
    setOn(Object.fromEntries(entries) as Record<BrandId, boolean>)
  }

  useEffect(() => {
    check().catch(() => {})
  }, [])

  async function enable(brand: BrandId) {
    if (!user) return
    setBusy(true)
    try {
      await ensureTransitLocation(brand, user)
      await check()
      toast.success(t('เปิดใช้ระบบส่งสินค้าแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
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
        {BRANDS.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-0 flex-1 font-medium">{b.name}</div>
            {on[b.id] === null ? (
              <span className="text-sm text-ink-faint">{t('กำลังโหลด...')}</span>
            ) : on[b.id] ? (
              <Badge color="green">{t('เปิดใช้แล้ว')}</Badge>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => void enable(b.id)}>
                {t('เปิดใช้ระบบส่งสินค้า')}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
