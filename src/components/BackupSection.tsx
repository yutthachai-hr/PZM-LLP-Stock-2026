import { useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useConfirm } from './Confirm'
import { useToast } from './Toast'
import { Button, Card } from './ui'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import {
  BackupFormatError,
  RESTORE_MODES,
  backupSize,
  buildBackup,
  downloadBackup,
  parseBackup,
  restoreBackup,
  type RestoreMode,
} from '../services/backup'

/**
 * Manual backup and restore.
 *
 * The free Firestore plan has no point-in-time recovery and no scheduled backups — both
 * need billing enabled — so a mistaken delete cannot be undone from the server side. A
 * file the owner keeps in Drive is the only recovery path this project actually has.
 */
export function BackupSection() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const { brand } = useBrand()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [mode, setMode] = useState<RestoreMode>(RESTORE_MODES.repair)

  const brandName = brand ? brandDef(brand).name : ''

  async function download() {
    setBusy('backup')
    try {
      const b = await buildBackup(user?.name ?? '')
      downloadBackup(b)
      toast.success(t('สำรองข้อมูลแล้ว {n} รายการ', { n: backupSize(b) }))
      // Say so if the file was taken over balances that already disagreed with the
      // history. Restoring rebuilds them from the history, so the file is still usable —
      // but the owner should know the warehouse has something to look at.
      if (b.integrity.drift > 0) {
        toast.error(
          t('เตือน: ตอนสำรอง มียอดคงเหลือ {n} รายการไม่ตรงกับประวัติ — กด “ตรวจความสอดคล้องของยอด” ในหน้าตั้งค่า', {
            n: b.integrity.drift,
          }),
        )
      }
    } catch (e) {
      toast.error(t('สำรองข้อมูลไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be chosen again after a cancel
    if (!file) return

    let parsed
    try {
      parsed = parseBackup(await file.text())
    } catch (err) {
      const reason =
        err instanceof BackupFormatError
          ? t('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของระบบ')
          : errText(err, t)
      toast.error(reason)
      return
    }

    // Restoring into the wrong brand would mix two companies' stock together.
    const crossBrand = parsed.brand !== brand
    const ok = await confirm({
      title: t('กู้คืนข้อมูลจากไฟล์สำรอง'),
      message:
        t('ไฟล์นี้สำรองจาก {brand} เมื่อ {when} — มี {n} รายการ', {
          brand: parsed.brandName,
          when: new Date(parsed.createdAt).toLocaleString(),
          n: backupSize(parsed),
        }) +
        '\n\n' +
        (crossBrand
          ? t('⚠️ ไฟล์นี้เป็นของคนละแบรนด์กับที่เปิดอยู่ ({current}) — ข้อมูลจะปนกัน', {
              current: brandName,
            }) + '\n\n'
          : '') +
        (mode === RESTORE_MODES.overwrite
          ? t('โหมดเขียนทับ: ข้อมูลหลัก (สินค้า คลัง รูป บันทึก) จะถูกเขียนกลับตามไฟล์ ทับการแก้ไขที่ทำหลังสำรอง')
          : t('โหมดเติมที่หาย: เขียนเฉพาะรายการที่หายไป ของที่แก้ไขหลังสำรองจะไม่ถูกแตะ')) +
        '\n\n' +
        t('ประวัติการเคลื่อนไหวเป็นข้อมูลที่เพิ่มได้อย่างเดียว รายการที่บันทึกหลังสำรองจะยังอยู่ครบ และยอดคงเหลือกับเลขเอกสารจะถูกสร้างใหม่จากประวัติทั้งหมดหลังกู้คืน'),
      danger: true,
      confirmText: t('กู้คืน'),
      typeToConfirm: crossBrand ? parsed.brandName : undefined,
    })
    if (!ok) return

    setBusy('restore')
    try {
      const r = await restoreBackup(parsed, mode)
      toast.success(
        t('กู้คืนแล้ว: เขียนใหม่ {written} รายการ, คงเดิม {kept} รายการ, สร้างยอดใหม่ {rebuilt} รายการ, ข้าม {skipped} รายการ', {
          written: r.written,
          kept: r.kept,
          rebuilt: r.rebuilt,
          skipped: r.skipped,
        }),
      )
    } catch (err) {
      // A restore is idempotent, so the honest advice after a failure is to run it again.
      toast.error(t('กู้คืนไม่สำเร็จ:') + ' ' + errText(err, t) + ' — ' + t('กดกู้คืนไฟล์เดิมซ้ำได้ ระบบจะทำต่อจากเดิมโดยไม่สร้างข้อมูลซ้ำ'))
    } finally {
      setBusy('')
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-1 font-semibold text-slate-800">{t('สำรอง / กู้คืนข้อมูล')}</h2>
      <p className="mb-3 text-xs text-slate-500">
        {t('ดาวน์โหลดข้อมูลทั้งหมดของ {brand} เป็นไฟล์เดียว แล้วเก็บไว้ใน Google Drive หรือ OneDrive', {
          brand: brandName,
        })}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={download} disabled={!!busy}>
          {busy === 'backup' ? t('กำลังสำรอง...') : t('💾 ดาวน์โหลดไฟล์สำรอง')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={pickFile}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          {busy === 'restore' ? t('กำลังกู้คืน...') : t('♻️ กู้คืนจากไฟล์')}
        </Button>
      </div>

      <fieldset className="mt-3 space-y-1 text-xs text-slate-600">
        <legend className="mb-1 font-medium text-slate-700">{t('วิธีกู้คืน')}</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="restore-mode"
            className="mt-0.5"
            checked={mode === RESTORE_MODES.repair}
            onChange={() => setMode(RESTORE_MODES.repair)}
          />
          <span>{t('เติมเฉพาะที่หาย — ปลอดภัยที่สุด ใช้เมื่อข้อมูลถูกลบไป')}</span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="restore-mode"
            className="mt-0.5"
            checked={mode === RESTORE_MODES.overwrite}
            onChange={() => setMode(RESTORE_MODES.overwrite)}
          />
          <span>{t('เขียนทับข้อมูลหลักด้วย — ใช้เมื่อแก้สินค้า/คลังผิดแล้วอยากย้อนกลับ')}</span>
        </label>
      </fieldset>

      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {t('⚠️ แผนฟรีของ Firebase ไม่มีระบบกู้ข้อมูลย้อนหลัง ถ้าลบผิดจะกู้ไม่ได้เลย — ควรกดสำรองอย่างน้อยสัปดาห์ละครั้ง')}
      </p>
    </Card>
  )
}
