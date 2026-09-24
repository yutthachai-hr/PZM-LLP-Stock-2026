import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { BRANDS, type BrandId } from '../../brand/brand'
import { useBrand } from '../../brand/BrandContext'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, SectionHeader, SegTab } from '../../components/ui'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { compressImage } from '../../lib/image'
import { buddhistYear } from '../../services/sequence'
import { makeAnnouncementNo } from '../../services/announcements'
import { saveCompanyProfile, useCompanyProfile } from '../../services/companyProfile'

/**
 * ข้อมูลบริษัท — the company as its documents present it: the die-cut logo, the name
 * printed on them, and the prefix a document number starts with. One per company; an admin
 * may set either company's from here.
 *
 * The logo is shrunk in the browser and kept as PNG so a die-cut shape keeps its
 * transparent edge.
 */
export function CompanyProfileSection() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const { brand } = useBrand()
  const [company, setCompany] = useState<BrandId>(brand ?? 'pizza')
  const { profile, loaded, reload } = useCompanyProfile(company)
  const [prefix, setPrefix] = useState('')
  const [code, setCode] = useState('')
  const [display, setDisplay] = useState('')
  const [logo, setLogo] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!loaded) return
    setPrefix(profile.docPrefix)
    setCode(profile.announcementCode)
    setDisplay(profile.displayName ?? '')
    setLogo(undefined)
  }, [loaded, profile])

  const shownLogo = logo === undefined ? profile.logoDataUrl : logo

  async function pick(file: File | undefined) {
    if (!file) return
    try {
      setLogo(await compressImage(file, { maxDim: 600, keepTransparency: true }))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  async function save() {
    if (!user) return
    setBusy(true)
    try {
      await saveCompanyProfile(
        company,
        { docPrefix: prefix, announcementCode: code, displayName: display, logoDataUrl: logo },
        { id: user.id, role: user.role },
      )
      reload()
      toast.success(t('บันทึกแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const sample = makeAnnouncementNo(
    { docPrefix: prefix.toUpperCase().replace(/[^A-Z0-9]/g, '') || '?', announcementCode: code.toUpperCase().replace(/[^A-Z0-9]/g, '') || '?' },
    buddhistYear(Date.now()),
    1,
  )

  return (
    <Card className="p-4">
      <SectionHeader
        icon="building"
        title={t('ข้อมูลบริษัท')}
        description={t('โลโก้และตัวย่อเลขเอกสารที่ใช้ในประกาศบริษัท')}
      />
      <div className="mb-4 flex gap-1 rounded-lg bg-sunken p-1">
        {BRANDS.map((b) => (
          <SegTab key={b.id} label={b.name} active={company === b.id} onClick={() => setCompany(b.id)} />
        ))}
      </div>
      {!loaded ? (
        <p className="py-2 text-sm text-ink-faint">{t('กำลังโหลด...')}</p>
      ) : (
        <div className="space-y-4">
          <Field label={t('โลโก้ (Die Cut)')} hint={t('PNG พื้นใส ย่อเหลือไม่เกิน 600 พิกเซลอัตโนมัติ')}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-24 w-40 items-center justify-center rounded-lg border border-dashed border-line-strong bg-white">
                {shownLogo ? (
                  <img src={shownLogo} alt="" className="max-h-20 max-w-36 object-contain" />
                ) : (
                  <span className="text-xs text-ink-faint">{t('ยังไม่มีโลโก้')}</span>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                {t('เลือกไฟล์โลโก้')}
              </Button>
              {shownLogo && (
                <Button variant="ghost" onClick={() => setLogo(null)}>
                  {t('เอาโลโก้ออก')}
                </Button>
              )}
            </div>
          </Field>
          <Field label={t('ชื่อที่พิมพ์ในเอกสาร')} hint={t('เว้นว่างไว้ = ใช้ชื่อแบรนด์')}>
            <Input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder={BRANDS.find((b) => b.id === company)?.name} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('ตัวย่อบริษัท')} hint={t('A-Z และ 0-9 ไม่เกิน 10 ตัว')}>
              <Input value={prefix} maxLength={10} onChange={(e) => setPrefix(e.target.value)} />
            </Field>
            <Field label={t('รหัสประเภทเอกสารประกาศ')}>
              <Input value={code} maxLength={10} onChange={(e) => setCode(e.target.value)} />
            </Field>
          </div>
          <p className="text-sm text-ink-soft">
            {t('ตัวอย่างเลขที่')}: <span className="doc-no font-semibold text-ink">{sample}</span>
          </p>
          <div className="flex justify-end">
            <Button onClick={save} disabled={busy}>
              {busy ? t('กำลังบันทึก...') : t('บันทึก')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
