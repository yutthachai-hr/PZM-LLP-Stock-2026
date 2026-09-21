# Mobile/Tablet UI — Round 2: Keying screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone, รับเข้า / โอน / เบิกใช้ / ปรับสต๊อก become one-screen forms where the product search sits on top, tapping a product opens a bottom sheet with a large quantity field and the unit, added lines are cards, and the "today" panel folds under the form (spec §3).

**Architecture:** One new component, `QtySheet`, owns "how many, in what unit" on a phone (reusing `entryUnitsFor` / `UnitSelect` / `DefineConversionModal` from `QtyInput.tsx`). `LineBuilder` keeps its tablet/desktop rendering and, on a phone (`useViewport() === 'phone'`), renders cards and routes adds/edits through `QtySheet`. A pure `upsertLine` in `src/lib/lines.ts` is the only new logic and is unit-tested. `TodayTransactions` folds itself on phones; `WithTodayPanel` puts the panel beside the form from `lg` (1024) instead of `xl`. Services, data and rules are untouched.

**Tech Stack:** React 19, Tailwind v4, vitest (node). Round 1 shells (`useViewport`, `Modal compact`, `FormActions`) are in place on main.

## Global Constraints

- Desktop `≥ 1280px` looks and behaves exactly as today; tablet keeps the inline qty/unit rows.
- Every tap target ≥ 44px; number fields use `inputMode="decimal"`; no horizontal page scroll at 375px.
- Every new Thai UI string gets an `en.ts` entry (`npm run i18n:check`); Thai data labels carry `// i18n-key`.
- No data, service or rules changes. Drafts (`useDraft`) and the instant "today" rows (`recentWrites`) keep working.
- Gate before every commit: `npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm run i18n:check && npm test && npm run build`.
- Files are CRLF; Python edits read/write with `newline=''`. Work on branch `feat/mobile-keying`, merge to main at the end.

---

### Task 1: `upsertLine` — the one piece of logic

**Files:**
- Create: `src/lib/lines.ts`
- Test: `tests/lines.test.ts`

**Interfaces:**
- Consumes: `Line` from `src/components/LineBuilder.tsx` (`{ productId, productName, unit, entryUnit?, entryQty?, qty, note? }`), `QtyEntry` from `src/lib/uom.ts` (`{ qty, entryQty, entryUnit?, factor }`).
- Produces: `upsertLine(lines: Line[], product: { id: string; name: string; unitType: string }, entry: QtyEntry): Line[]` — replaces the line for that product or appends it; a zero entry removes it. `lineOf(product, entry): Line`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lines.test.ts
// A phone keys one product at a time through a sheet; this is what the sheet hands back.
import { describe, expect, test } from 'vitest'
import { lineOf, upsertLine } from '../src/lib/lines'

const mozz = { id: 'p1', name: 'Mozzarella', unitType: 'EA' }
const ham = { id: 'p2', name: 'Ham', unitType: 'KG' }

describe('upsertLine', () => {
  test('a new product is appended, keyed in its own unit or another', () => {
    const a = upsertLine([], mozz, { qty: 3, entryQty: 3, factor: 1 })
    expect(a).toEqual([{ productId: 'p1', productName: 'Mozzarella', unit: 'EA', qty: 3 }])
    const b = upsertLine(a, ham, { qty: 16, entryQty: 2, entryUnit: 'Carton', factor: 8 })
    expect(b[1]).toEqual({ productId: 'p2', productName: 'Ham', unit: 'KG', qty: 16, entryUnit: 'Carton', entryQty: 2 })
  })

  test('the same product again replaces its line in place, and a zero removes it', () => {
    const a = upsertLine([lineOf(mozz, { qty: 3, entryQty: 3, factor: 1 }), lineOf(ham, { qty: 1, entryQty: 1, factor: 1 })], mozz, { qty: 5, entryQty: 5, factor: 1 })
    expect(a.map((l) => [l.productId, l.qty])).toEqual([['p1', 5], ['p2', 1]])
    const b = upsertLine(a, mozz, { qty: 0, entryQty: 0, factor: 1 })
    expect(b.map((l) => l.productId)).toEqual(['p2'])
  })

  test('switching back to the product\'s own unit drops the keyed-unit fields', () => {
    const a = upsertLine([], mozz, { qty: 16, entryQty: 2, entryUnit: 'Carton', factor: 8 })
    const b = upsertLine(a, mozz, { qty: 4, entryQty: 4, factor: 1 })
    expect(b[0]).toEqual({ productId: 'p1', productName: 'Mozzarella', unit: 'EA', qty: 4 })
  })
})
```

- [ ] **Step 2: Run it — expect "cannot find module"**

Run: `npx vitest run tests/lines.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/lines.ts
import type { Line } from '../components/LineBuilder'
import type { QtyEntry } from './uom'

/** One form line from what the quantity sheet handed back. */
export function lineOf(product: { id: string; name: string; unitType: string }, e: QtyEntry): Line {
  return {
    productId: product.id,
    productName: product.name,
    unit: product.unitType,
    qty: e.qty,
    ...(e.entryUnit ? { entryUnit: e.entryUnit, entryQty: e.entryQty } : {}),
  }
}

/**
 * The lines with this product's line set to the entry: replaced where it already is,
 * appended where it is not, removed when the entry is nothing. A phone keys one product
 * at a time through a sheet, and tapping a product already on the list edits it rather
 * than adding a twin (the same rule the request picker learned on 21 Sep 2026).
 */
export function upsertLine(lines: Line[], product: { id: string; name: string; unitType: string }, e: QtyEntry): Line[] {
  const rest = lines.filter((l) => l.productId !== product.id)
  if (!(e.qty > 0)) return rest
  const next = lineOf(product, e)
  const at = lines.findIndex((l) => l.productId === product.id)
  if (at < 0) return [...lines, next]
  return lines.map((l, i) => (i === at ? next : l))
}
```

- [ ] **Step 4: Run — expect 3 passing**, then commit:

```bash
git checkout -b feat/mobile-keying
git add src/lib/lines.ts tests/lines.test.ts
git commit -m "Lines: one product, one line, from a sheet's entry"
```

---

### Task 2: `QtySheet`

**Files:**
- Create: `src/components/QtySheet.tsx`
- Modify: `src/components/QtyInput.tsx` (export `EntryUnit` is already exported; nothing else)

**Interfaces:**
- Consumes: `Modal` (`compact`, `footer`), `entryUnitsFor`, `entryOf`, `UnitSelect` from `QtyInput.tsx`; `useEntryUnits` from `services/entryUnits`; `isCountUnit` from `lib/uom`; `fmtQty` from `lib/format`; `ProductThumb`.
- Produces:
  ```tsx
  <QtySheet
    open: boolean
    product: { id: string; name: string; sku: string; unitType: string; hasImage: boolean; unitConversions?: UnitConversion[] } | null
    initial?: { qty: number; entryQty?: number; entryUnit?: string }   // editing an existing line
    available?: number            // on hand at the source site; warns when exceeded
    direction: 'in' | 'out'
    submitLabel: string           // already translated
    extra?: ReactNode             // fields the caller adds above the buttons (Adjust: direction, reason)
    onClose: () => void
    onSubmit: (entry: QtyEntry) => void
    onRateDefined?: (conversions: UnitConversion[]) => void
  />
  ```

- [ ] **Step 1: Write the component**

```tsx
// src/components/QtySheet.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n/I18nContext'
import { fmtQty } from '../lib/format'
import type { UnitConversion } from '../lib/units'
import { isCountUnit, type QtyEntry } from '../lib/uom'
import { useEntryUnits } from '../services/entryUnits'
import { ProductThumb } from './ProductThumb'
import { entryOf, entryUnitsFor, UnitSelect } from './QtyInput'
import { blurOnWheel, Button, Modal } from './ui'

/**
 * "How many, in what unit" on a phone (spec §3, 21 Sep 2026): a sheet that rises when a
 * product is tapped, with the number set large under the thumb and the numeric keyboard
 * already up. The same list of units and the same ask-once rate prompt as the inline
 * QtyInput the tablet keeps; only the geometry is different.
 */
export function QtySheet({
  open,
  product,
  initial,
  available,
  direction,
  submitLabel,
  extra,
  onClose,
  onSubmit,
  onRateDefined,
}: {
  open: boolean
  product: { id: string; name: string; sku: string; unitType: string; hasImage: boolean; unitConversions?: UnitConversion[] } | null
  initial?: { qty: number; entryQty?: number; entryUnit?: string }
  available?: number
  direction: 'in' | 'out'
  submitLabel: string
  extra?: ReactNode
  onClose: () => void
  onSubmit: (entry: QtyEntry) => void
  onRateDefined?: (conversions: UnitConversion[]) => void
}) {
  const t = useT()
  const plainUnits = useEntryUnits()
  const units = useMemo(
    () => (product ? entryUnitsFor(product.unitType, plainUnits, product.unitConversions) : []),
    [product, plainUnits],
  )
  const [entryUnit, setEntryUnit] = useState('')
  const [text, setText] = useState('')
  const box = useRef<HTMLInputElement>(null)

  // Start from the line being edited, or empty; focus the number so the keyboard is up.
  useEffect(() => {
    if (!open) return
    setEntryUnit(initial?.entryUnit ?? '')
    setText(initial ? String(initial.entryQty ?? initial.qty) : '')
    setTimeout(() => box.current?.focus(), 50)
  }, [open, initial])

  if (!product) return null
  const unit = units.find((u) => u.records.toLowerCase() === (entryUnit || product.unitType).toLowerCase()) ?? units[0]
  const factor = unit?.factor ?? 1
  const entry = unit ? entryOf(text, unit, factor) : { qty: 0, entryQty: 0, factor: 1 }
  const over = available !== undefined && direction === 'out' && entry.qty > available
  const fraction = isCountUnit(product.unitType) && entry.qty > 0 && !Number.isInteger(entry.qty)
  const canSubmit = entry.qty > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product.name}
      compact
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => onSubmit(entry)} disabled={!canSubmit} className="flex-[2]">
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs text-ink-soft">
          <ProductThumb productId={product.id} hasImage={product.hasImage} size={36} />
          <div>
            <div className="doc-no">{product.sku}</div>
            {available !== undefined && (
              <div className={over ? 'font-medium text-danger' : ''}>
                {t('คงเหลือ')}: <span className="num">{fmtQty(available)}</span> {product.unitType}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-stretch gap-2">
          <input
            ref={box}
            type="number"
            step="any"
            min={0}
            inputMode="decimal"
            value={text}
            onWheel={blurOnWheel}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) {
                e.preventDefault()
                onSubmit(entry)
              }
            }}
            className={`num min-h-14 w-full rounded-xl border-2 px-3 text-right text-3xl font-bold text-ink outline-none ${
              over ? 'border-danger bg-danger-soft' : 'border-brand focus-visible:ring-2 focus-visible:ring-brand/25'
            }`}
            aria-label={t('จำนวน')}
          />
          <div className="w-32 shrink-0">
            <UnitSelect
              units={units}
              value={entryUnit}
              onChange={setEntryUnit}
              product={product}
              onRateDefined={(list) => onRateDefined?.(list)}
              className="min-h-14 text-base"
            />
          </div>
        </div>
        {entry.entryUnit && entry.qty > 0 && (
          <p className="text-right text-sm text-ink-soft">
            = <span className="num font-semibold text-ink">{fmtQty(entry.qty)}</span> {product.unitType}
          </p>
        )}
        {over && <p className="text-sm font-medium text-danger">{t('เกินคงเหลือ — บันทึกไม่ได้')}</p>}
        {fraction && (
          <p className="text-sm font-medium text-warn">
            {t('จะบันทึก {qty} {unit} (ไม่เต็มหน่วย) — ตรวจสอบหน่วยอีกครั้ง', { qty: fmtQty(entry.qty), unit: product.unitType })}
          </p>
        )}
        {extra}
      </div>
    </Modal>
  )
}
```

Notes: `UnitSelect` accepts `className` (already); `Button` accepts `className`. `entryOf` returns `entryUnit` only when the unit is not the base — so `entry.entryUnit` doubles as "was another unit picked".

- [ ] **Step 2: Gate**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run i18n:check`. Add the missing English strings (expected: `'คงเหลือ': 'On hand'` may exist; `'เกินคงเหลือ — บันทึกไม่ได้': 'More than on hand — cannot be filed'`).

- [ ] **Step 3: Commit**

```bash
git add src/components/QtySheet.tsx src/i18n/en.ts
git commit -m "QtySheet: how many, in what unit, under the thumb"
```

---

### Task 3: `LineBuilder` on a phone — search on top, sheet to add, cards to edit

**Files:**
- Modify: `src/components/LineBuilder.tsx`

**Interfaces:**
- Consumes: `useViewport`, `QtySheet`, `upsertLine`, `describeQty` (already imported), `fmtQty`.
- Produces: same props as today; behaviour differs only when `useViewport() === 'phone'`.

- [ ] **Step 1: State and handlers**

At the top of `LineBuilder` add:

```tsx
const vp = useViewport()
const phone = vp === 'phone'
// The product the sheet is open for, and the line it is editing (undefined = adding).
const [sheetFor, setSheetFor] = useState<Product | null>(null)
```

Change `addProduct` so a phone opens the sheet instead of adding "1":

```tsx
function addProduct(p: Product) {
  if (phone) {
    setSearch('')
    setSheetFor(p)
    return
  }
  onChange([...lines, { productId: p.id, productName: p.name, unit: p.unitType, qty: 1 }])
  setSearch('')
  setTimeout(() => searchBox.current?.focus(), 0)
}
```

and add:

```tsx
function sheetSubmit(e: QtyEntry) {
  if (!sheetFor) return
  onChange(upsertLine(lines, sheetFor, e))
  setSheetFor(null)
  setTimeout(() => searchBox.current?.focus(), 0)
}
```

Imports: `import { useViewport } from '../lib/viewport'`, `import { QtySheet } from './QtySheet'`, `import { upsertLine } from '../lib/lines'`.

- [ ] **Step 2: Search results — static list on phones, with on-hand**

Change the results container class from `absolute z-20 mt-1 max-h-80 w-full overflow-auto …` to `mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg md:absolute md:z-20` (on a phone the list pushes the form down instead of floating over it — nothing under it is needed while choosing). Inside each result button, after the sku span, add:

```tsx
{availableAt && (
  <span className="num shrink-0 text-xs text-ink-soft">{fmtQty(availableAt(p.id))} {p.unitType}</span>
)}
```

Also let a phone list products already on the form (tapping one edits it): change `.filter((p) => !chosen.has(p.id))` to `.filter((p) => phone || !chosen.has(p.id))`.

- [ ] **Step 3: Lines as cards on phones**

Wrap the existing `lines.map(...)` row markup in `phone ? (card) : (existing row)`. The card:

```tsx
<button
  key={l.productId}
  type="button"
  onClick={() => setSheetFor(product ?? null)}
  className="flex w-full items-center gap-3 p-3 text-left outline-none active:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
>
  <span aria-hidden="true" className={`num w-4 shrink-0 text-center text-lg font-bold leading-none ${signColor}`}>{sign}</span>
  <div className="min-w-0 flex-1">
    <div className="truncate text-sm font-medium text-ink">{l.productName}</div>
    <div className={`text-xs ${over ? 'font-medium text-danger' : 'text-ink-soft'}`}>
      {avail !== undefined ? <>{t('คงเหลือต้นทาง')}: <span className="num">{fmtQty(avail)}</span> {l.unit}</> : product?.sku}
    </div>
  </div>
  <div className="num shrink-0 text-right text-base font-semibold text-ink">{describeQty(l, fmtQty)}</div>
  <span
    role="button"
    tabIndex={0}
    onClick={(e) => { e.stopPropagation(); remove(l.productId) }}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); remove(l.productId) } }}
    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-faint active:bg-danger-soft active:text-danger"
    aria-label={t('ลบ "{name}" ออกจากรายการ', { name: l.productName })}
  >
    <Icon name="x" size={18} />
  </span>
</button>
```

(`Product` here must carry `sku` and `hasImage` — it does.) At the end of the component's JSX add:

```tsx
<QtySheet
  open={!!sheetFor}
  product={sheetFor}
  initial={sheetFor ? lines.find((l) => l.productId === sheetFor.id) : undefined}
  available={sheetFor && availableAt ? availableAt(sheetFor.id) : undefined}
  direction={direction}
  submitLabel={sheetFor && lines.some((l) => l.productId === sheetFor.id) ? t('บันทึก') : t('เพิ่มรายการ')}
  onClose={() => setSheetFor(null)}
  onSubmit={sheetSubmit}
  onRateDefined={() => undefined}
/>
```

`initial` takes a `Line` (it has `qty`, `entryQty?`, `entryUnit?`) — the prop type accepts it structurally.

- [ ] **Step 4: Gate and look**

Run the gate. Demo at 375: /receive → type "moz" → list below the box shows name · sku; tap → sheet with big number, unit ▾, "เพิ่มรายการ"; type 2, pick Carton → "= 16 EA"; add → card "MOZZARELLA … 2 Carton (= 16 EA)"; tap the card → sheet shows 2 / Carton, change to 3 → card updates; × removes. /issue (เบิกใช้) → on-hand shown in results and in the sheet; keying more than on hand turns the field red and disables the button. At 1280: rows unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/LineBuilder.tsx
git commit -m "LineBuilder on a phone: search on top, a sheet to key, cards to edit"
```

---

### Task 4: Header rows and the today panel

**Files:**
- Modify: `src/pages/Receive.tsx`, `src/pages/Issue.tsx` (both forms), `src/pages/Adjust.tsx` (header only), `src/components/movements/TodayTransactions.tsx`

- [ ] **Step 1: Site + date on one line, actor hidden on phones**

Receive: `<div className="grid gap-4 sm:grid-cols-3">` → `<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">`, and the actor `<Field label={t("ผู้รับเข้า (บันทึกอัตโนมัติ)")}>` gets `className="hidden sm:block"`.
Issue transfer: `<div className="grid gap-4 sm:grid-cols-2">` → `<div className="grid grid-cols-2 gap-3 sm:gap-4">`; actor field `className="hidden sm:block"`; the date field gets `className="col-span-2 sm:col-span-1"` so on a phone the row is from/to, then date full width.
Issue consume: same as Receive's header (find its `grid gap-4 sm:grid-cols-3`).
Adjust: `<div className="grid gap-4 sm:grid-cols-2">` → `<div className="grid grid-cols-2 gap-3 sm:gap-4">`.

`Field` accepts `className` (see `ui.tsx` — it does).

- [ ] **Step 2: The today panel folds on phones; sits beside from `lg`**

In `TodayTransactions.tsx`:
- import `useViewport`;
- add `const phone = useViewport() === 'phone'` and `const [openPanel, setOpenPanel] = useState(false)`;
- the header `<div className="flex items-center justify-between gap-2 border-b …">` becomes a button on phones: wrap the title block in `<button type="button" onClick={() => setOpenPanel((v) => !v)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={openPanel}>` with a `<Icon name={openPanel ? 'chevronDown' : 'chevronRight'} size={16} className="text-ink-faint md:hidden" />` at the start (render the button only when `phone`; otherwise the plain div as today);
- the body (`{rows.length === 0 ? … : <ul …>}`) renders only when `!phone || openPanel`;
- the Card class drops `max-h-[calc(100vh-8rem)]` on phones: `className={`flex flex-col overflow-hidden ${phone ? '' : 'max-h-[calc(100vh-8rem)] lg:sticky lg:top-4'}`}`.

In `WithTodayPanel` change `xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start` to `lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start`.

- [ ] **Step 3: Gate and look**

Demo at 375: /receive header is two fields on one line, no actor field; the today panel is a single row "รับเข้าที่ทำวันนี้ · 21/09/69 · 1 รายการ" with a chevron; tap expands. At 1024×768: panel beside the form. At 768×1024: panel below, expanded.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Receive.tsx src/pages/Issue.tsx src/pages/Adjust.tsx src/components/movements/TodayTransactions.tsx
git commit -m "Keying screens: two-up header on phones; the today panel folds and sits beside from lg"
```

---

### Task 5: Adjust on a phone — the sheet carries direction and reason

**Files:**
- Modify: `src/pages/Adjust.tsx`

**Interfaces:**
- Consumes: `QtySheet` (`extra` slot), `useViewport`, `Select`, `ADJUST_REASONS`.

- [ ] **Step 1: State**

Add `const phone = useViewport() === 'phone'` and `const [sheet, setSheet] = useState(false)`. When a product is picked on a phone (both the Enter handler and the result button), also `setSheet(true)`. When the summary row is tapped, `setSheet(true)`.

- [ ] **Step 2: The sheet**

Render, at the end of the page's JSX:

```tsx
{phone && (
  <QtySheet
    open={sheet && !!product}
    product={product}
    initial={entry.qty > 0 ? { qty: entry.qty, entryQty: entry.entryQty, entryUnit: entry.entryUnit } : undefined}
    available={direction === 'out' ? current : undefined}
    direction={direction}
    submitLabel={t('ตกลง')}
    extra={
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('ทิศทาง')}>
          <Select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
            <option value="out">{t('ลดออก (−)')}</option>
            <option value="in">{t('เพิ่มเข้า (+)')}</option>
          </Select>
        </Field>
        <Field label={t('เหตุผล')}>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {ADJUST_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{t(r.label)}</option>
            ))}
          </Select>
        </Field>
      </div>
    }
    onClose={() => setSheet(false)}
    onSubmit={(e) => { setEntry(e); setSheet(false) }}
    onRateDefined={(list) => setProduct((p) => (p ? { ...p, unitConversions: list } : p))}
  />
)}
```

- [ ] **Step 3: The inline row becomes a summary on phones**

Wrap the existing `<div className="grid gap-4 sm:grid-cols-3">` (direction / qty / reason) in `{!phone && (…)}` and add, for phones, after the product field:

```tsx
{phone && product && (
  <button
    type="button"
    onClick={() => setSheet(true)}
    className="flex min-h-14 w-full items-center justify-between rounded-lg border border-line px-3 text-left outline-none active:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
  >
    <span className="text-sm text-ink-soft">
      {direction === 'out' ? t('ลดออก (−)') : t('เพิ่มเข้า (+)')} · {t(ADJUST_REASONS.find((r) => r.value === reason)?.label ?? reason)}
    </span>
    <span className="num text-base font-semibold text-ink">
      {entry.qty > 0 ? describeQty({ qty: entry.qty, entryQty: entry.entryQty, entryUnit: entry.entryUnit, unit: product.unitType }, fmtQty) : t('ใส่จำนวน')}
    </span>
  </button>
)}
```

(`describeQty` from `lib/uom`, `fmtQty` from `lib/format` — import if missing.)

- [ ] **Step 4: Gate and look**

Demo at 375: /adjust → search → tap product → sheet with number, unit, direction, reason → ตกลง → summary row "ลดออก (−) · ของหาย   3 EA"; tap the row → sheet again; บันทึก works; the draft restores the summary. At 1280: unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Adjust.tsx src/i18n/en.ts
git commit -m "Adjust on a phone: one sheet for how many, which way and why"
```

---

### Task 6: Round-2 finish — HANDOFF, gate, merge, deploy

- [ ] **Step 1: HANDOFF** — under "UI สามขนาดหน้าจอ" add: "รอบ 2 (หน้าคีย์): `components/QtySheet.tsx` (จำนวน+หน่วยบนมือถือ, ใช้ Modal compact+footer), `lib/lines.ts` (`upsertLine` — สินค้าเดิม = แถวเดิม), `LineBuilder` แยกโหมด phone (การ์ด+ชีต) / อื่น (แถวเดิม), `TodayTransactions` พับได้บนมือถือ, `WithTodayPanel` วางข้างจาก `lg`; ปรับสต๊อกบนมือถือใช้ชีตเดียวกัน (ทิศทาง+เหตุผลอยู่ในชีต)".

- [ ] **Step 2: Full gate** (incl. `npx tsc -p worker/tsconfig.json --noEmit && npm run build`).

- [ ] **Step 3: Walk the demo** at 375 (receive → 2 lines → save → today panel shows them; issue over-stock blocked; adjust flow; drafts restore), 768, 1024, 1280.

- [ ] **Step 4: Merge and deploy**

```bash
git checkout main && git merge --no-ff feat/mobile-keying -m "Merge feat/mobile-keying: keying screens on a phone"
git push origin main
```

Poll `curl -s https://pzmstock.pages.dev/ | grep -o 'index-[^"]*\.js'` until it matches `dist/assets/index-*.js`.
