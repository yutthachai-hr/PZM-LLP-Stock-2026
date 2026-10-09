import { useMemo, useState, type FormEvent } from 'react'
import { useData } from '../data/DataContext'
import { useT } from '../i18n/I18nContext'
import { Badge, Button } from '../components/ui'
import { askPzm, hintProduct, hintSite, type AskAnswer, type AskFailure, type AskOp, type AskRequest } from '../services/ask'

/**
 * Ask PZM — read-only operations assistant (staging pilot, owner approval 4, 9 Oct 2026).
 * Mobile first: one column, the answer card under the box, sources and freshness on the card.
 * Product and site are suggested from data already loaded and can be cleared before asking.
 */
const examples = (t: ReturnType<typeof useT>) => [t('ดู Stock Feta ที่อ่อนนุช'), t('PO ไหนผู้ขายยังไม่ยืนยัน'), t('Feta ที่อ่อนนุชเสี่ยงหมดใน 7 วันไหม')]

function uncertaintyText(u: string, t: ReturnType<typeof useT>): string {
  switch (u) {
    case 'intent_from_model':
      return t('เดาหัวข้อคำถามด้วย AI — ตรวจว่าตรงกับที่ถาม')
    case 'too_little_history':
      return t('ประวัติการใช้น้อยเกินไปที่จะคำนวณอัตราการใช้')
    case 'history_capped':
      return t('ประวัติยาวเกินขอบเขตการอ่าน — ตัวเลขอาจไม่ครบ')
    case 'orders_capped':
    case 'levels_capped':
      return t('ข้อมูลมากเกินขอบเขตการอ่าน — แสดงบางส่วน')
    case 'product_hint_not_found':
      return t('ไม่พบสินค้าที่เลือกในฐานข้อมูล')
    case 'site_hint_not_found':
      return t('ไม่พบสาขาที่เลือกในฐานข้อมูล')
    case 'model_malformed':
      return t('AI ตอบผิดรูปแบบ — ไม่ใช้คำตอบนั้น')
    default:
      return u.startsWith('model_') ? t('AI ไม่พร้อมใช้งาน — ตอบโดยไม่ใช้ AI') : u
  }
}

function failureText(f: AskFailure, t: ReturnType<typeof useT>): string {
  switch (f) {
    case 'unauthorized':
      return t('กรุณาเข้าสู่ระบบใหม่')
    case 'rate_limited':
      return t('ถามถี่เกินไป — รอสักครู่แล้วลองใหม่')
    case 'not_available':
      return t('Ask PZM ยังไม่เปิดในระบบนี้')
    case 'network':
      return t('เชื่อมต่อไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่')
    default:
      return t('มีข้อผิดพลาด ลองใหม่อีกครั้ง')
  }
}

function ago(ms: number, now: number, t: ReturnType<typeof useT>) {
  const m = Math.max(0, Math.round((now - ms) / 60_000))
  return m < 1 ? t('เมื่อสักครู่') : m < 60 ? t('{n} นาทีที่แล้ว', { n: m }) : t('{n} ชั่วโมงที่แล้ว', { n: Math.round(m / 60) })
}

export function AskPzmPage() {
  const t = useT()
  const { products, locations } = useData()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [failure, setFailure] = useState<AskFailure | null>(null)
  const [cleared, setCleared] = useState<{ product?: boolean; site?: boolean }>({})

  const productId = useMemo(() => (cleared.product ? undefined : hintProduct(text, products)), [text, products, cleared.product])
  const siteId = useMemo(() => (cleared.site ? undefined : hintSite(text, locations)), [text, locations, cleared.site])
  const productName = products.find((p) => p.id === productId)?.name
  const siteName = locations.find((l) => l.id === siteId)?.name

  async function send(req: AskRequest) {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const r = await askPzm(req)
    setBusy(false)
    if (r.ok) setAnswer(r.answer)
    else {
      setAnswer(null)
      setFailure(r.failure)
    }
  }

  function submit(e?: FormEvent, q = text) {
    e?.preventDefault()
    const question = q.trim()
    if (!question) return
    void send({ text: question, hints: { ...(productId ? { productId } : {}), ...(siteId ? { siteId } : {}) } })
  }

  // ---- guided: pick the operation and the records; no language involved ----
  const [gProduct, setGProduct] = useState('')
  const [gSite, setGSite] = useState('')
  const [gDays, setGDays] = useState(7)
  const activeProducts = useMemo(() => products.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [products])
  const activeSites = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const guided = (op: AskOp) => void send({ op, hints: { ...(gProduct ? { productId: gProduct } : {}), ...(gSite ? { siteId: gSite } : {}) }, ...(op === 'STOCKOUT_RISK' ? { horizonDays: gDays } : {}) })

  const tone = answer?.kind === 'ANSWER' ? 'green' : answer?.kind === 'REFUSE' ? 'red' : 'amber'
  const now = Date.now()

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4 md:px-0">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-ink">Ask PZM</h1>
          <Badge color="amber">{t('ทดลอง · อ่านอย่างเดียว')}</Badge>
        </div>
        <p className="text-sm text-ink-faint">{t('ถามเรื่องสต๊อกคงเหลือ ใบสั่งซื้อที่รอผู้ขายยืนยัน และความเสี่ยงของหมด — ตัวเลขทุกตัวมาจากฐานข้อมูล ไม่ได้มาจาก AI')}</p>
      </header>

      <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-3">
        <label htmlFor="ask-text" className="sr-only">
          {t('คำถาม')}
        </label>
        <textarea
          id="ask-text"
          value={text}
          maxLength={300}
          rows={2}
          onChange={(e) => {
            setText(e.target.value)
            setCleared({})
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={t('เช่น ดูสต๊อก Feta ที่อ่อนนุช')}
          className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        />
        {(productName || siteName) && (
          <div className="flex flex-wrap gap-2 text-xs" aria-label={t('ข้อมูลที่ใช้ถาม')}>
            {productName && (
              <button type="button" onClick={() => setCleared((c) => ({ ...c, product: true }))} className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full bg-brand-soft px-3 text-brand">
                {t('สินค้า')}: {productName} <span aria-hidden>×</span>
                <span className="sr-only">{t('เอาออก')}</span>
              </button>
            )}
            {siteName && (
              <button type="button" onClick={() => setCleared((c) => ({ ...c, site: true }))} className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full bg-brand-soft px-3 text-brand">
                {t('สาขา')}: {siteName} <span aria-hidden>×</span>
                <span className="sr-only">{t('เอาออก')}</span>
              </button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-faint">{text.length}/300</span>
          <Button type="submit" disabled={busy || !text.trim()} className="min-h-11 min-w-24">
            {busy ? t('กำลังค้นหา…') : t('ถาม')}
          </Button>
        </div>
      </form>

      <section aria-labelledby="ask-guided" className="space-y-3 rounded-xl border border-line bg-surface p-3">
        <h2 id="ask-guided" className="text-sm font-semibold text-ink">
          {t('หรือเลือกเอง')}
        </h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-ink-faint">
            {t('สินค้า')}
            <select value={gProduct} onChange={(e) => setGProduct(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink">
              <option value="">{t('— เลือกสินค้า —')}</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.sku ? ` · ${p.sku}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-faint">
            {t('สาขา')}
            <select value={gSite} onChange={(e) => setGSite(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink">
              <option value="">{t('— ทุกสาขาในสิทธิ์ —')}</option>
              {activeSites.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-faint">
            {t('ช่วงความเสี่ยง (วัน)')}
            <select value={gDays} onChange={(e) => setGDays(Number(e.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink">
              {[3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy || !gProduct} onClick={() => guided('STOCK_LOOKUP')} className="min-h-11">
            {t('ดูสต๊อกคงเหลือ')}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => guided('PO_UNCONFIRMED')} className="min-h-11">
            {t('PO ที่ผู้ขายยังไม่ยืนยัน')}
          </Button>
          <Button type="button" variant="secondary" disabled={busy || !gProduct || !gSite} onClick={() => guided('STOCKOUT_RISK')} className="min-h-11">
            {t('ความเสี่ยงของหมด')}
          </Button>
        </div>
      </section>

      {!answer && !failure && (
        <div className="flex flex-wrap gap-2">
          {examples(t).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setText(q)
                setCleared({})
              }}
              className="min-h-10 cursor-pointer rounded-full border border-line bg-surface px-3 text-sm text-ink-soft active:bg-sunken"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {failure && (
        <div role="alert" className="rounded-xl border border-out/30 bg-out-soft p-3 text-sm text-out">
          {failureText(failure, t)}
        </div>
      )}

      {answer && (
        <article aria-live="polite" className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={tone}>{answer.kind === 'ANSWER' ? t('คำตอบ') : answer.kind === 'REFUSE' ? t('ทำให้ไม่ได้') : t('ต้องการข้อมูลเพิ่ม')}</Badge>
          </div>
          {/* The answer text is data written by the server from database values: shown as is. */}
          <p className="whitespace-pre-line text-base text-ink">{answer.text}</p>
          <AnswerFacts answer={answer} />
          {answer.uncertainty.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-warn-soft p-2 text-xs text-warn">
              {answer.uncertainty.map((u) => (
                <li key={u}>• {uncertaintyText(u, t)}</li>
              ))}
            </ul>
          )}
          <footer className="space-y-1 border-t border-line pt-2 text-xs text-ink-faint">
            <div>
              {t('อ่านข้อมูลเมื่อ')} {new Date(answer.freshness.readAt).toLocaleTimeString()}
              {answer.freshness.dataUpdatedAt ? ` · ${t('ข้อมูลอัปเดตล่าสุด')} ${ago(answer.freshness.dataUpdatedAt, now, t)}` : ''}
            </div>
            {answer.sources.length > 0 && (
              <div>
                {t('แหล่งข้อมูล')}: {answer.sources.map((s) => `${s.collection.replace(/^\w+__/, '')} (${s.ids.length})`).join(', ')}
              </div>
            )}
            <div>{t('อ่าน {n} รายการ · {ms} ms', { n: answer.reads, ms: answer.ms })}</div>
          </footer>
        </article>
      )}
    </div>
  )
}

function AnswerFacts({ answer }: { answer: AskAnswer }) {
  const t = useT()
  const orders = (answer.facts?.orders as { docNo: string; supplierName: string; daysWaiting: number }[] | undefined) ?? []
  if (answer.intent === 'po_unconfirmed' && orders.length)
    return (
      <ul className="divide-y divide-line rounded-lg border border-line">
        {orders.map((o) => (
          <li key={o.docNo} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="font-medium text-ink">{o.docNo}</span>
            <span className="min-w-0 flex-1 truncate text-ink-soft">{o.supplierName}</span>
            <span className="shrink-0 text-xs text-ink-faint">{t('รอ {n} วัน', { n: o.daysWaiting })}</span>
          </li>
        ))}
      </ul>
    )
  return null
}
