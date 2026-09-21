# Mobile/Tablet UI — Round 4: Phone home and finishing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone, "/" is a home screen — today's tiles (tasks · receiving · low stock · overdue), what I keyed today (editable), pending requests, today's calendar items — and the remaining screens (calendar, settings, receive-order dialog, LINE send) are checked at 375px and fixed where they overflow (spec §2 and the round-4 list).

**Architecture:** `PhoneHome` (`src/pages/PhoneHome.tsx`) composes what already exists — `TodayPanel` (calendar feed tiles + today/upcoming lists), `TodayTransactions` (gains `byUserId` and `startOpen`), `RequestWidget` — and `DashboardPage` returns it when `useViewport() === 'phone'`; the desktop dashboard is untouched. No new data reads: the feed and the movement window are already in memory or cached.

**Tech Stack:** React 19, Tailwind v4, vitest.

## Global Constraints

- Desktop `≥ 1280px` unchanged. Tap targets ≥ 44px. No horizontal page scroll at 375px.
- New Thai strings get an `en.ts` entry. No data/service/rules changes; no new listeners or reads.
- Gate before every commit: `npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm run i18n:check && npm test && npm run build`. Branch `feat/mobile-home`, merged to main at the end.

---

### Task 1: `TodayTransactions` — mine only, open by default

**Files:** `src/components/movements/TodayTransactions.tsx`

- [ ] Add props `byUserId?: string` (keep only rows with `m.byUserId === byUserId`) and `startOpen?: boolean` (initial `openPanel`), applied in the `rows` memo and the `useState(startOpen ?? false)`.
- [ ] Gate; commit `"TodayTransactions: only mine, and open from the start"`.

### Task 2: `PhoneHome`

**Files:** Create `src/pages/PhoneHome.tsx`; modify `src/pages/Dashboard.tsx` (early return after the hooks).

- [ ] Component:

```tsx
import { useAuth } from '../auth/AuthContext'
import { TodayPanel } from '../components/dashboard/TodayPanel'
import { TodayTransactions } from '../components/movements/TodayTransactions'
import { RequestWidget } from './requests/RequestWidget'
import { useT } from '../i18n/I18nContext'

/** The phone's first screen (spec §2, 21 Sep 2026): what is due, what I did, what is waiting. */
export function PhoneHome() {
  const t = useT()
  const { user } = useAuth()
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">{t('สวัสดี {name}', { name: user?.name ?? '' })}</p>
      <TodayPanel />
      <TodayTransactions
        types={['receive', 'issue', 'consume', 'adjust']}
        date={Date.now()}
        title={t('รายการที่ฉันทำวันนี้')}
        byUserId={user?.id}
        startOpen
      />
      <RequestWidget />
    </div>
  )
}
```

(Check the `MovementType` union in `src/types.ts` for the exact type names; use all of them.)

- [ ] In `DashboardPage`, after the last hook and before `return (`, add `const phone = useViewport() === 'phone'` **above** the other hooks' order is not required — put `const phone = useViewport() === 'phone'` right after `const t = useT()` so hook order is stable, and immediately before the JSX `return (` add `if (phone) return <PhoneHome />`.
- [ ] Gate; demo at 375: "/" shows greeting, four tiles, today's list, my transactions (the receipt keyed earlier, with แก้ไข), requests widget; at 1280 the dashboard is as before. Commit `"Phone home: today, what I did, what is waiting"`.

### Task 3: Finishing pass at 375px

**Files:** whatever the walk finds — expected: `src/pages/calendar/CalendarPage.tsx`, `src/pages/Settings.tsx`, `src/pages/Orders.tsx` (ReceiveModal), `src/pages/purchase/SendWizard.tsx`, `src/components/PoSheet.tsx`.

- [ ] Walk in the demo at 375: /calendar (month grid → is there an agenda view on phones? if the grid overflows, show `AgendaList` below `md`), /settings and one topic, /orders → ตรวจรับของ (the receive dialog: quantity boxes ≥ 96px wide, buttons in the footer), the LINE send wizard (sheet fits width; buttons reachable), /suppliers, /requests/new (picker tabs; cart under the picker). For each overflow: note file:line and fix with responsive classes only. Record what was fixed in the commit message.
- [ ] Gate; commit `"Phone: calendar/settings/receive/send fit the screen"`.

### Task 4: Finish

- [ ] HANDOFF bullet: "รอบ 4: `pages/PhoneHome.tsx` (หน้าแรกมือถือ = TodayPanel + รายการที่ฉันทำวันนี้ + RequestWidget; `DashboardPage` คืน PhoneHome เมื่อ phone), `TodayTransactions` มี `byUserId`/`startOpen`; แก้จุดล้นจอที่พบ: …"
- [ ] Full gate incl. worker typecheck + build; merge `feat/mobile-home` → main; push; poll the bundle.
