# Inventory Calendar + Task Management + Notifications (4 phases)

## Context

The owner wants the existing Inventory Pzm dashboard extended with a real operations calendar
(stock counts, receiving, purchasing deadlines, low/out of stock, adjustments, waste, supplier
cut-offs, reorder advice), task management (scheduled stock counts, manual tasks, reschedule
history) and an in-app notification centre with automatic generation and escalation — and
the "บันทึกช่วยจำ" (notes) tab removed. Constraints: Firebase **Spark** (50k reads / 20k writes
per day shared by two brands, no Cloud Functions), hosting on Cloudflare Pages, max 7 realtime
listeners (all in `src/data/DataContext.tsx`), Firestore rules 1,000-expression budget
(`validShape(name, docId, d, fresh)` already splits create/update; `tests/firestore-rules-budget.test.ts`
replays widest docs), no paid services, no LINE bot, rules deployed before code that writes new
fields. **No audit, no transfer, no expiry modules** (owner: expiry postponed — no batch/lot data).

Owner decisions (2026-09-17): background jobs = **Cloudflare Worker + Cron** with a least-privilege
service-account key as a Cloudflare secret (Firestore REST); two new collections approved:
`notifications`, `inventorySchedules`; the `notes` listener is retired to free the 7th slot;
deliver in **4 phases, each merged + deployed** (A calendar → B schedules/tasks → C notifications +
Worker → D reorder/stockout/thresholds/weekly).

## What exists and is reused (verified)

- Calendar: `src/pages/Calendar.tsx` (month/week/agenda, filters, MonthGrid "+n more", DayPanel/EventDrawer
  via `<Modal side>`, EventEditor), `StockEvent` in `stockEvents` (`src/types.ts:339-378`; startAt is the only
  queried field), `src/services/events.ts` (listEventsInRange via `getRange`, create/update/setEventStatus,
  dayBounds/monthGridBounds/weekBounds), `src/data/eventCache.ts` (range map, patch-in-place),
  `src/data/useTodayEventCount.ts` → sidebar badge in `src/components/Layout.tsx`.
- Low-stock rule duplicated in `src/pages/Dashboard.tsx:59-73` and `src/components/TopBar.tsx:37-48`
  (`tracksProduct`, `minFor`, `qtyAt` from DataContext) — lift into one shared function.
- Purchasing: `src/services/purchaseOrders.ts` (status draft|ordered|received, `orderedAt`, `listOrdersInRange`,
  `CHASE_AFTER_DAYS=3`, `overdueOrders`, `receivePurchaseOrder`), `src/services/purchaseRequests.ts`
  (`listRequestsInRange` on createdAt, statuses, `liveItems`), `src/pages/requests/RequestWidget.tsx`
  (one-shot widget pattern), suppliers `leadTimeDays`/`defaultLocationId` + session cache `useSuppliers()`.
- Inventory: movements `receive|issue|consume|adjust` with `ADJUST_REASONS` (`lost|broken|expired|damage|found|count|opening`),
  `product.cost`, `src/lib/ledger.ts` pure helpers, 30-day movement window in memory.
- UI kit `src/components/ui.tsx` (Modal `side`, Badge colours, StatGroup/StatTile, SegTab, EmptyState…),
  `Icon.tsx` (add `bell, clock, alertCircle, box, cart, checkCircle`), `useToast`, `useConfirm`.
- Backend interface (`getRange`, `subscribe` with `since`), memory backend for tests, rules harness, gate
  (`npm test`, `npm run lint`, `npm run i18n:check`, `npm run build`, `npm run test:rules`).

## Architecture

**Derived vs persisted.** Persist only what has a workflow: stock-count tasks generated from schedules
(deterministic id `sc__<scheduleId>__<yyyymmdd>` → `set`/`exists:false` is idempotent) and manual tasks.
Everything else is **derived at read time** by pure code from data already loaded or one range read —
PO expected/arriving/delayed (expectedAt = orderedAt + supplier.leadTimeDays), PR pending approval,
supplier cut-off instances, low/out of stock, estimated stockout, significant adjustment, waste, reorder.
No duplicates by construction. "Overdue" is derived (`dueAt ?? endOfDay(startAt) < now` on open tasks),
not a stored status; only its *notification* is persisted.

**Shared pure rules** in `src/lib/inventoryRules/` (no imports of backend/react/i18n/firebase — pinned by a
test): `types.ts` (CalendarItem view-model: id/kind/sourceType/sourceId/titleKey+params/at/allDay/
locationId/supplierId/productId/priority/status/meta/persisted), `time.ts` (fixed UTC+7 Bangkok day math:
`bkkDayKey/bkkDayStart/bkkDayEnd/bkkAtTime/bkkWeekday`), `calendarFeed.ts` (`buildFeed(input)`),
`lowStock.ts`, `purchasing.ts` (`expectedDeliveryAt`, `poStatus`, `openPurchaseFor` (open PR: draft|
pendingApproval|returned|approved containing product; open PO: draft|ordered with line), `incomingFor`,
`cutoffItems`), `permissions.ts` (`actionsFor(item, user)`), `schedules.ts` (`occurrencesBetween`,
`taskIdFor`, `buildTaskDoc`), `notifications.ts` (rule engine: evaluate*, dedupKey, recipients by role/
assignment, priority, `isFor(n,user,prefs)`, escalation), `copy.ts` (Thai title/body per kind, `// i18n-key`),
`usage.ts`/`reorder.ts`/`adjustments.ts` (Phase D). Used by the client (feed, demo automation) and the Worker.

**Range cache**: generalise `eventCache.ts` into `src/data/rangeCache.ts` (`createRangeCache<T>` with
*covering* lookup — a narrower range is served from a cached wider one) with three instances:
events (`startAt`), orders (`orderedAt`, window `[from−45d, to]`), requests (`createdAt`, `[from−30d, to]`).
`useCalendarFeed(range)` feeds Calendar, Dashboard Today/Upcoming and RequestWidget from the same fetches.

**Notifications**: brand-scoped `notifications` collection, one doc per notification, id = dedup key
(date-instanced `taskToday__<eventId>`, `cutoffSoon__<supplierId>__<yyyymmdd>`, `dailyBrief__<yyyymmdd>`;
state-based `lowStock__<pid>__<loc>`, `outOfStock__<pid>__<loc>`, `poDelayed__<poId>`, `reorder__<pid>__<loc>`
re-armed only after recovery via `active:false`). Fields: kind, category (task|inventory|purchasing|
supplier|system), priority (critical|high|medium|info), `to {all?, roles?, uids?}`, `params`, `link`,
locationId/productId/supplierId, active/resolvedAt, `readBy {uid: ms}`, source (worker|client), createdBy,
createdAt/updatedAt/expiresAt(30d). One listener `useLive(COL.notifications, {sinceField:'createdAt',
sinceValue: sessionStart−7d})` in DataContext (replaces `notes`) — recipients/prefs filtered client-side;
unread = `!readBy[uid]`. Read marks write only `readBy.<uid>` (dotted path; add to local/memory backends).
Prefs per user as `inventorySchedules/prefs__<uid>` (users doc is admin-update-only), muted priorities per
category; critical never mutable. Purge: Worker job deletes `createdAt < now−30d` (≤50/day); Firestore TTL
optional later.

**Worker** (`worker/`): `wrangler.toml` (name `pzmstock-cron`, crons `*/30 * * * *`, daily 00:05 & 07:00 BKK,
Mon 07:30 BKK; vars `FIREBASE_PROJECT_ID`, `WORKER_ENABLED`), `src/index.ts` (scheduled + `/health`),
`auth.ts` (SA JWT RS256 via WebCrypto → OAuth token, cached), `firestore.ts` (runQuery/get/batchWrite with
`currentDocument.exists:false` preconditions → zero dedup reads), `codec.ts`, `brands.ts` (`''`,`lelapin__`),
`jobs/` (generateStockCountTasks, taskReminders+overdue+escalation, purchaseWatch, dailyBrief, weeklySummary,
purgeNotifications, heartbeat → `meta/cronStatus`). Secret `FIREBASE_SERVICE_ACCOUNT` (JSON) set with
`wrangler secret put`; owner creates a dedicated service account with only `roles/datastore.user`.
Kill switch `WORKER_ENABLED=false`. A test greps `worker/src` so it writes only stockEvents, notifications,
meta/cronStatus. **Demo parity**: `src/services/automation.ts` runs the same pure jobs client-side —
always in local mode (demo), and in cloud mode only for manager/admin when `meta/cronStatus.lastRunAt`
is older than 26h (also covers Phase B before the Worker exists), once per Bangkok day per device.

**Rules** (all cheap, validators placed early in `validShape`): Phase A suppliers `orderDays: number[]≤7`,
`cutoffTime 'HH:mm'`; Phase B `stockEvents` split `eventFrozen/eventLive` (+ sourceType, sourceId, scheduleId,
refKey, productId, supplierId, history≤100, rescheduledFrom, startedBy/At, completedBy/At, approvedBy/At,
cancelReason; status += `waitingApproval`), create by `manager()`, staff edit only status/started*/
completed*/history on tasks assigned to them (or assignedToAll), manager full live edit with history never
shrinking, delete manager (own/generated) or admin; `inventorySchedules` write gated by doc-id prefix
(`prefs__<uid>` self, `snooze__` active, else admin), validators by `kind`; `meta/cronStatus` read active,
write false. Phase C `notifications`: read active; create client only in own name with `source:'client'`;
update only `readBy`+`updatedAt` and only the caller's key; delete admin. Budget test gains widest event and
notification replays.

**UI**: split `Calendar.tsx` into `src/pages/calendar/` (CalendarPage, MonthGrid, WeekView, DayView,
AgendaList, Filters [location/kind/status/priority/supplier/search], SummaryCards, ItemDrawer with per-kind
bodies + history + action bar from `actionsFor`, RescheduleModal, EventEditor [types stockCount|delivery|
inventoryTask|other], MobileHome [Today → Critical → My tasks → Upcoming → CompactMonth], chips.ts with
semantic tones from existing tokens). `Modal` gains `sheet` (bottom sheet <sm). TopBar gets
`NotificationBell` + `NotificationPanel` (tabs all/critical/tasks/inventory/purchasing/supplier). Dashboard
gets `TodayPanel` + `UpcomingList` (clickable → `/calendar?filter=…`). Settings gets Schedules,
Thresholds, Notification prefs, Automation status ("run now" for manager+). Suppliers form gets order-day
chips + cut-off time. Nav: remove `/notes` entry, route, `NotesPage`, `services/notes.ts`, and the `notes`
listener; keep `COL.notes`, rules, backup entry (old backups still restore).

## Phases (each: rules → tests → services → UI → gate → demo walkthrough → merge → deploy)

### Phase A — Calendar feed, filters, drawer, mobile, dashboard Today/Upcoming, notes tab removal
- Rules: supplier `orderDays`/`cutoffTime` (deploy first).
- Create `src/lib/inventoryRules/{types,time,calendarFeed,lowStock,purchasing,permissions}.ts`,
  `src/data/{rangeCache,orderCache,requestCache,useCalendarFeed}.ts`, `src/pages/calendar/*`,
  `src/components/dashboard/{TodayPanel,UpcomingList}.tsx`.
- Modify `eventCache.ts` (wrapper), `Dashboard.tsx`, `RequestWidget.tsx`, `TopBar.tsx`, `ui.tsx` (sheet),
  `Icon.tsx`, `Layout.tsx`, `App.tsx`, `DataContext.tsx`, `types.ts`, `services/suppliers.ts`,
  `Suppliers.tsx`, `firestore.rules`, `en.ts`. Delete `Calendar.tsx` (moved), `Notes.tsx`, `services/notes.ts`.
- Tests: `tests/inventory-rules/{time,calendar-feed,purchasing}.test.ts`, `tests/range-cache.test.ts`,
  update `event-cache`, `suppliers`, rules tests (supplier fields).

### Phase B — Stock-count schedules, task workflow, reschedule history, manager tasks
- Rules: stockEvents split + manager create + staff assigned edits + `waitingApproval`; `inventorySchedules`
  (kinds `stockCount`, `settings`); `meta/cronStatus`.
- Create `schedules.ts` (rules), `src/services/schedules.ts` (list/save/delete/settings + session cache),
  `src/services/automation.ts`, `src/pages/settings/{SchedulesSection,ThresholdsSection,AutomationStatus}.tsx`,
  `RescheduleModal.tsx`. Modify `types.ts` (StockEvent fields, InventorySchedule, InventorySettings,
  EventHistoryEntry, COL), `services/events.ts` (start/complete(requiresApproval)/approve/reschedule(reason)/
  cancel, history in actor's name), `ItemDrawer.tsx`, `Settings.tsx`, `backup.ts` (FORMAT_VERSION 6), rules, tests.
- Tests: schedules occurrences (daily/weekly/biweekly/monthly-clamp/custom, disabled, twice = zero new),
  events workflow, automation on memory backend, rules (manager create, staff assigned complete, unassigned
  refused, reschedule needs reason+history), budget replay of widest event.

### Phase C — Notification centre, preferences, daily brief, escalation, Worker
- Rules: `notifications`; `inventorySchedules` kind `prefs`.
- Create `notifications.ts` + `copy.ts` (rules), `src/services/notifications.ts` (markRead, deliverDrafts),
  `src/data/useNotifications.ts`, `src/components/notifications/{NotificationBell,NotificationPanel,NotificationRow}.tsx`,
  `settings/NotificationPrefsSection.tsx`, `worker/**`, `tests/worker/fakeClient.ts`.
- Modify `DataContext.tsx` (7th listener), `TopBar.tsx`, `Settings.tsx`, `types.ts`, backends (dotted key),
  `purchaseRequests.submitRequest` + `events.completeEvent` (instant drafts to managers), `package.json`
  (`worker:dev`, `worker:deploy`, build adds `tsc -p worker/tsconfig.json`), rules, HANDOFF (owner steps).
- Tests: engine (dedup/re-arm, priorities, recipients, prefs, escalation, BKK midnight), service (unread,
  readBy only, every link resolves to a route), worker (codec, JWT, each job: budgets, `exists:false`, second
  run writes nothing), rules, budget replay.

### Phase D — Reorder, estimated stockout, adjustment/waste thresholds, weekly summary
- Create `usage.ts` (issue+consume out of location = usage; adjust-out lost/broken/expired/damage = loss;
  guard ≥2 moves & ≥7d history; avgDaily), `reorder.ts` (`need = avgDaily×(leadTime+coverDays)+safety`,
  `qty = max(0, ceil(need − onHand − incoming))`, MOQ floor, min-stock fallback labelled), `adjustments.ts`
  (value = qty×cost, thresholds by ฿ or %), `ReorderCard.tsx`, `worker/src/jobs/weeklySummary.ts`.
- Modify feed (new kinds), `ItemDrawer` (Reorder/Adjustment bodies: create PR / dismiss / snooze doc
  `snooze__reorder__<pid>__<loc>`; "มีการสั่งซื้ออยู่แล้ว PR-… " when `openPurchaseFor` hits), `Adjust` page
  (instant draft after `adjustStock`), `RequestEditor` query-param prefill, `dailyBrief` job (stockout).
- Tests: usage, reorder table incl. no-PR-duplicate, adjustments thresholds, weekly summary, feed kinds.

## Quota analysis (delivered with the final report, re-checked in Firebase console)

Method: reads per occurrence × occurrences/day × 4 devices (+ Worker per brand). Estimate: baseline ~12k +
notifications listener ~1.3k + calendar/dashboard ranges ~2.2k + config ~150 + Worker ~4.3k (reminders every
30 min ≈1.4k, brief ≈2.5k, purchase ≈0.2k, generation ≈0.1k) ≈ **20–21k reads/day (≈40%)**, writes ≈1.2k/day,
deletes ≈40/day. `tests/quota-budget.test.ts` computes the model from the real constants and fails above
30k reads / 5k writes. Knobs: reminders hourly, 5-day notification window.

## Verification
- Every phase: `npm test`, `npm run test:rules`, `npm run lint`, `npm run i18n:check`, `npm run build`;
  demo walkthrough (`npm run demo`, Browser pane `pizza-stock-demo`): calendar month/week/day/agenda + filters
  + drawer actions at 1280 and 375 px; schedules → generated tasks (run twice, no dup) → staff start/complete
  → manager approve/reschedule with reason → history; bell unread → read → navigates; prefs mute; reorder card
  with existing PR shows "already in progress"; notes tab gone, `/notes` redirects.
- Phase C on production: `wrangler tail` shows jobs; Settings → Automation status shows last run; Firebase
  console Usage tab two days later vs the model.
- Final report: files created/modified, DB changes, indexes (none — single-field ranges), env/secrets,
  cron jobs, permissions, functions, tests, bugs fixed, not done (expiry, audit, transfer, push/email/LINE
  adapters beyond the interface), how to test each feature, quota table.
