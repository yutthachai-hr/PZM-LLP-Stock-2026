# Multi-bill Receive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One receiving screen holds several supplier bills; saving files one RC- document per bill.

**Architecture:** Pure bill logic (`planBills`, `restoreBills`) in `src/pages/receive/bills.ts`, tested; a `BillCard` component wraps the existing `LineBuilder` with a bill-number field; `Receive.tsx` keeps shared site/date and a list of bills, and calls the unchanged `receiveStock` once per bill.

**Tech Stack:** React 19, TypeScript, Tailwind v4, vitest.

## Global Constraints
- No change to `firestore.rules`, `services/stock.ts`, or the data model — one RC- per bill, note = bill number.
- Every Thai string through `t('…')` with an English entry in `src/i18n/en.ts` (single-quoted keys, `t()` on one line).
- Files are CRLF; edit by script with `newline=''`.
- Gate before commit: `npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm run i18n:check && npm test && npm run build`.

---

### Task 1: Bill logic

**Files:** Create `src/pages/receive/bills.ts` · Test `tests/multi-bill-receive.test.ts`

**Interfaces — Produces:**
- `interface Bill { id: string; note: string; lines: Line[] }`
- `emptyBill(): Bill`
- `planBills(bills: Bill[]): { ok: true; bills: Bill[] } | { ok: false; index: number; reason: 'noNote' | 'noLines' | 'badQty' | 'nothing' }` — `index` is 0-based into the input
- `restoreBills(saved: unknown): Bill[]` — accepts the new `{ bills }` draft and the old `{ note, lines }` one; never returns an empty array

- [ ] Write tests: empty bills skipped; bill with lines and no note → `noNote` at its index; note, no lines → `noLines`; qty ≤ 0 → `badQty`; all empty → `nothing`; order kept; same product in two bills allowed; old draft → one bill; new draft → same bills; garbage → one empty bill.
- [ ] Run `npx vitest run tests/multi-bill-receive.test.ts` → FAIL (module missing).
- [ ] Implement `bills.ts`.
- [ ] Run again → PASS. Commit.

### Task 2: BillCard + Receive screen

**Files:** Create `src/pages/receive/BillCard.tsx` · Modify `src/pages/Receive.tsx`, `src/i18n/en.ts`

**Interfaces — Consumes:** Task 1. `LineBuilder` props unchanged.

- [ ] `BillCard({ index, bill, onChange, onRemove?, autoFocusNote, products, onHandAt })` — SectionCard titled `บิล {n}`, bill-number Textarea (autoFocus when asked), LineBuilder with `lineNotes`, remove button when `onRemove` given (confirm if it has lines).
- [ ] `Receive.tsx`: state `bills`, draft `{ toLocationId, dateStr, bills }` restored through `restoreBills`; header card without the note field; map bills → BillCard; `+ เพิ่มบิล`; submit = `planBills` → error toast naming the bill, else file each bill in order, dropping each from state as it lands, toast the doc numbers; on a failure stop and name the bill.
- [ ] Button label `บันทึกรับเข้า {bills} บิล ({n} รายการ)`.
- [ ] English strings; `npm run i18n:check` clean; typecheck clean. Commit.

### Task 3: Verify and ship

- [ ] Demo at 1440 / 768 / 375: two bills, save → two RC- rows in today's panel each with its own note; remove a bill; leave and come back → draft restored.
- [ ] Full gate; merge to `main`; push `main` and `demo`; confirm bundle on `pzmstock.pages.dev`; HANDOFF line.
