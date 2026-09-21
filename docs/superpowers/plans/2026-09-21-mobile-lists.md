# Mobile/Tablet UI — Round 3: Lists as cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone every long list (orders, products/stock, history, reports, suppliers, activity) reads as compact cards — title, one large figure, one meta line, action buttons — with "load more" instead of page numbers (spec §4). Tablet and desktop keep the tables.

**Architecture:** `DataTable` already renders cards below `sm`; this round moves that to `md` (the phone shell's edge), gives each column a `card` role (`'value'` = the large figure at the right of the title; `'meta'` = joined into one line under it, the default; `'hidden'`), and lets each page mark its quantity column `card: 'value'`. `Pagination` shows a "โหลดเพิ่ม" button on phones. The request list is already a card list and stays.

**Tech Stack:** React 19, Tailwind v4, vitest.

## Global Constraints

- Desktop `≥ 1280px` and tablet tables unchanged. Every tap target ≥ 44px. No horizontal page scroll at 375px.
- New Thai strings get an `en.ts` entry. No data/service/rules changes.
- Gate before every commit: `npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm run i18n:check && npm test && npm run build`. Branch `feat/mobile-lists`, merged to main at the end.

---

### Task 1: `DataTable` card roles

**Files:**
- Modify: `src/components/DataTable.tsx`
- Test: `tests/data-table-cards.test.ts`

**Interfaces:**
- Produces: `Column<T>.card?: 'value' | 'meta' | 'hidden'`; exported pure `cardParts<T>(columns: Column<T>[]): { title: Column<T>; value?: Column<T>; meta: Column<T>[] }` — `title` = the primary (or first) column; `value` = the first column with `card: 'value'`; `meta` = the rest in order, excluding `tableOnly`, `card: 'hidden'`, the title and the value.

- [ ] **Step 1: Failing test**

```ts
// tests/data-table-cards.test.ts
// Which columns go where on a phone card (spec §4, 21 Sep 2026).
import { describe, expect, test } from 'vitest'
import { cardParts, type Column } from '../src/components/DataTable'

const col = (key: string, over: Partial<Column<unknown>> = {}): Column<unknown> => ({ key, header: key, cell: () => null, ...over })

describe('cardParts', () => {
  test('title is the primary column, the value the one marked, meta the rest in order', () => {
    const cols = [col('date'), col('name', { primary: true }), col('qty', { card: 'value' }), col('site'), col('actions', { tableOnly: true }), col('balance', { card: 'hidden' })]
    const p = cardParts(cols)
    expect(p.title.key).toBe('name')
    expect(p.value?.key).toBe('qty')
    expect(p.meta.map((c) => c.key)).toEqual(['date', 'site'])
  })
  test('with nothing marked the first column is the title and there is no value', () => {
    const p = cardParts([col('a'), col('b')])
    expect(p.title.key).toBe('a')
    expect(p.value).toBeUndefined()
    expect(p.meta.map((c) => c.key)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Implement** — add to `Column`: `/** Where the cell goes on a phone card: the large figure beside the title, the meta line (default), or nowhere. */ card?: 'value' | 'meta' | 'hidden'`. Add:

```ts
export function cardParts<T>(columns: Column<T>[]): { title: Column<T>; value?: Column<T>; meta: Column<T>[] } {
  const title = columns.find((c) => c.primary) ?? columns[0]
  const value = columns.find((c) => c.card === 'value' && c !== title)
  const meta = columns.filter((c) => c !== title && c !== value && !c.tableOnly && c.card !== 'hidden')
  return { title, value, meta }
}
```

Replace the phone card markup with (breakpoints `sm` → `md` on both the card list `md:hidden` and the table `hidden md:block`):

```tsx
const { title, value, meta } = cardParts(columns)
…
<div key={rowKey(row)} className={`p-3 ${onRowClick ? 'cursor-pointer active:bg-sunken' : ''} ${rowClassName?.(row) ?? ''}`} onClick={…}>
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0 flex-1 font-medium text-ink">{title.cell(row)}</div>
    {value && <div className="num shrink-0 text-right text-base font-semibold text-ink">{value.cell(row)}</div>}
  </div>
  {meta.length > 0 && (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-soft">
      {meta.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1">
          <span className="text-ink-faint">{c.header}</span>
          <span className="text-ink">{c.cell(row)}</span>
        </span>
      ))}
    </div>
  )}
  {cardActions && <div className="mt-2 flex flex-wrap gap-2">{cardActions(row)}</div>}
</div>
```

Update the file's header comment: "below `md`", "the primary column as its heading, one marked column as the large figure beside it, the rest as one meta line".

- [ ] **Step 3: Gate, commit** — `git commit -m "DataTable cards: a title, one large figure, one meta line"`.

---

### Task 2: "Load more" on phones

**Files:** `src/components/ui.tsx` (`Pagination`)

- [ ] Inside `Pagination`, before the existing `return`, add the phone variant and hide the page controls on phones:

```tsx
const remaining = total - to
```

Render:

```tsx
<>
  <div className="flex flex-col items-center gap-2 pt-3 text-sm text-ink-soft md:hidden">
    <span className="num">{t('แสดง {to} จาก {total} รายการ', { to, total })}</span>
    {remaining > 0 && (
      <button className={`${btn} min-h-11 w-full border-line bg-surface text-ink hover:bg-sunken`} onClick={() => onPageSize(pageSize + sizes[1])}>
        {t('โหลดเพิ่ม ({n} รายการที่เหลือ)', { n: remaining })}
      </button>
    )}
  </div>
  <div className="hidden … md:flex">{/* the existing controls, with `flex` → `hidden md:flex` on their wrapper */}</div>
</>
```

Note `usePaged` resets to page 1 when `pageSize` changes, so growing the size keeps everything shown so far. Strings: `'แสดง {to} จาก {total} รายการ': 'Showing {to} of {total}'`, `'โหลดเพิ่ม ({n} รายการที่เหลือ)': 'Load more ({n} left)'`.

- [ ] Gate, commit — `"Pagination on a phone: load more"`.

---

### Task 3: Card roles per page

**Files:** `src/pages/Orders.tsx`, `src/pages/Products.tsx`, `src/pages/Movements.tsx`, `src/pages/Reports.tsx`, `src/pages/Suppliers.tsx`, `src/pages/reports/ActivityLog.tsx`

- [ ] Orders columns: `status` stays meta; `ordered` → `card: 'hidden'` (the number and status say enough; due date is what matters); `due` meta; `lines` meta.
- [ ] Products: `qty` → `card: 'value'`; `unit` → `card: 'hidden'` (the value cell already prints the unit — check `cell` at Products.tsx:241–260; if it does not, leave `unit` in meta); `min` meta; `category` meta.
- [ ] Movements: `qty` → `card: 'value'`; `balance` → `card: 'hidden'`; `by` meta; `type`, `location`, `docNo`, `date` meta.
- [ ] Reports: movement columns `qty` → `'value'`, `balance` (if present) `'hidden'`; snapshot columns `qty` → `'value'`.
- [ ] Suppliers: the products-count / lead-time column → `'value'` if one exists; otherwise leave.
- [ ] ActivityLog: `qty`/`change` column → `'value'` if present.
- [ ] Gate; in the demo at 375 open /orders (with an order placed), /products, /movements, /reports, /suppliers: each row is a card with title + large figure + one meta line, no horizontal scroll; at 1280 tables unchanged. Fix any filter row that overflows at 375 (make it `flex-wrap` or a scrolling chip row like `StatusTabs`).
- [ ] Commit — `"Lists on a phone: quantity large, the rest in one line"`.

---

### Task 4: Finish — HANDOFF, gate, merge, deploy

- [ ] HANDOFF bullet under "UI สามขนาดหน้าจอ": "รอบ 3 รายการ: `DataTable` การ์ดต่ำกว่า `md` — `Column.card` = 'value' (ตัวเลขใหญ่) / 'meta' (บรรทัดเดียว) / 'hidden'; `cardParts()` ทดสอบ `tests/data-table-cards.test.ts`; `Pagination` บนมือถือเป็น 'โหลดเพิ่ม'".
- [ ] Full gate incl. worker typecheck and build; walk 375 / 768 / 1280.
- [ ] `git checkout main && git merge --no-ff feat/mobile-lists && git push origin main`; poll the bundle name.
