import { useMemo, useState } from 'react'
import { SectionCard } from '../../components/frame'
import { Button } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { exportExcel } from '../../lib/export'
import { fmtQty } from '../../lib/format'
import type { MonthlyCountQuestion, Product } from '../../types'

/**
 * Rows of an imported file still waiting for a decision (owner, 29 Sep 2026): what the file
 * said, the note left with it, and the two ways to settle it — the product it is and its
 * count in that product's unit, or "not ours to import". The sheet cannot be confirmed
 * while any is open.
 */
export function QuestionsCard({
  questions,
  products,
  editable,
  busy,
  onAnswer,
}: {
  questions: Record<string, MonthlyCountQuestion>
  products: Product[]
  editable: boolean
  busy: boolean
  onAnswer: (key: string, answer: { productId: string; qty: number } | null) => Promise<void>
}) {
  const t = useT()
  const active = useMemo(() => products.filter((p) => p.active !== false), [products])
  const byLabel = useMemo(() => new Map(active.map((p) => [`${p.sku} · ${p.name}`, p])), [active])
  const [draft, setDraft] = useState<Record<string, { productId?: string; qty: string }>>({})
  const entries = Object.entries(questions).sort((a, b) => a[1].source.localeCompare(b[1].source) || a[1].excelRow - b[1].excelRow)

  function download() {
    exportExcel(
      'count-questions',
      t('คำถาม'),
      entries.map(([, q]) => ({
        [t('ที่มา')]: q.source,
        [t('แถว')]: q.excelRow,
        [t('รหัส')]: q.code,
        [t('ชื่อในไฟล์')]: q.name,
        [t('ขนาดบรรจุ')]: q.packSize,
        [t('จำนวน')]: q.qty,
        [t('หน่วย')]: q.fileUnit,
        [t('หมายเหตุ')]: q.note,
        [t('ผู้ตั้งคำถาม')]: q.byName,
      })),
    )
  }

  return (
    <SectionCard
      icon="info"
      tone="amber"
      title={t('คำถามจากไฟล์ที่นำเข้า')}
      count={entries.length}
      actions={
        <Button variant="secondary" onClick={download}>
          Excel
        </Button>
      }
      flush
    >
      <ul className="divide-y divide-line">
        {entries.map(([key, q]) => {
          const d = draft[key] ?? { qty: String(q.qty) }
          const p = d.productId ? products.find((x) => x.id === d.productId) : undefined
          const qty = Number(d.qty)
          return (
            <li key={key} className="space-y-2 px-4 py-3 md:px-5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-ink">{q.name || t('(ไม่มีชื่อ)')}</span>
                <span className="text-xs text-ink-faint">
                  {q.code || t('ไม่มีรหัส')} · {q.source} · {t('แถว {n}', { n: q.excelRow })}
                  {q.packSize && ` · ${t('ขนาดบรรจุ {size}', { size: q.packSize })}`} · {t('ในไฟล์')}{' '}
                  <b className="text-ink">
                    {fmtQty(q.qty)} {q.fileUnit || t('(ไม่ระบุหน่วย)')}
                  </b>
                </span>
              </div>
              {q.note && <div className="rounded-lg bg-warn-soft px-3 py-1.5 text-xs text-ink">{q.note}</div>}
              {editable && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    list="count-question-products"
                    placeholder={t('เป็นสินค้าตัวไหน — พิมพ์ค้นหารหัสหรือชื่อ')}
                    onChange={(e) => setDraft((all) => ({ ...all, [key]: { ...d, productId: byLabel.get(e.target.value)?.id } }))}
                    className="min-h-10 min-w-0 flex-1 rounded-lg border border-line-strong px-3 text-sm outline-none focus-visible:border-brand"
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={d.qty}
                    aria-label={t('จำนวนที่นับได้')}
                    onChange={(e) => setDraft((all) => ({ ...all, [key]: { ...d, qty: e.target.value } }))}
                    className="num min-h-10 w-24 rounded-lg border border-line-strong px-2 text-right outline-none focus-visible:border-brand"
                  />
                  <span className="text-xs text-ink-soft">{p?.unitType ?? ''}</span>
                  <Button disabled={busy || !p || !(qty >= 0) || d.qty === ''} onClick={() => p && void onAnswer(key, { productId: p.id, qty })}>
                    {t('ใช้ยอดนี้')}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void onAnswer(key, null)}>
                    {t('ไม่นำเข้า')}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <datalist id="count-question-products">
        {active.map((p) => (
          <option key={p.id} value={`${p.sku} · ${p.name}`} />
        ))}
      </datalist>
    </SectionCard>
  )
}
