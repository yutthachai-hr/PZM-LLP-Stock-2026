# Real-time in-app notifications (popups, sound, deep links)

Plan of 5 Oct 2026, from `main` + `feat/supplier-intelligence`. Extends the existing
notification system; no parallel store, no new collection.

## 1. Notification Center today
`NotificationBell` (`src/components/notifications/NotificationBell.tsx`) in the top bar:
tabs by category, unread count, opening one marks it read (`markRead`) and navigates to
its `link`; "mark all read". Text from `lib/inventoryRules/copy.ts` by kind + params.

## 2. Realtime
Firestore `onSnapshot` through `useLive` in `DataContext`: one listener on
`notifications` for the last 7 days (`NOTIFICATION_WINDOW_DAYS`). It already pushes new
documents to every open app within seconds. **No polling is added.**

## 3. Collections
`notifications` (brand-prefixed). One document per fact; the id is the dedup key
(`<kind>__<subject>[__<day>]`); `readBy: {uid: ms}`; `to: {all|roles|uids}`;
`priority: critical|high|medium|info`; `category`; `params`; `link`; `active`.

## 4. Generation points
- Client instant: `deliver()` — task approval, PR submitted/returned, transfers, adjustments.
- Engine (`evaluate` → `plan` → `applyPlan`): Worker or a manager's browser — poArriving,
  poDelayed, cutoffToday, low/out of stock, stockoutSoon, reorder, briefs.
- Server (Pages Functions, service account): supplierConfirmed / DateChanged /
  DatePending / DateApproved / DateRejected.

## 5. Preferences
`inventorySchedules/prefs__<uid>` = `{mute: {category: priority[]}}`, owner-only in rules
(`validPrefs` pins the keys). Sound settings go into the same document as `sound: {...}`
(N6, one rules key). Device facts — "this browser has unlocked audio", "prompt dismissed"
— are localStorage, because they are true of a device, not a person.

## 6. Roles
`admin | manager | staff`; audience resolved by `isAddressedTo()` at write time (`to`)
and filtered on read by `isFor()`. There is no "purchasing" or "warehouse" role; the
audience rules per kind (MANAGERS for supplier date decisions, the order's sender + managers
for supplier answers) stay in the draft builders.

## 7. Event contract
The stored document stays as it is (no migration). One pure function maps it to what the
host shows: `presentNotification(n)` in `src/lib/notificationPresentation.ts` →
`{ id, type: kind, severity, popup, sound, title, message, entityType, entityId,
actionUrl, actions[], metadata: params, createdAt }`. Severity: critical → CRITICAL;
success kinds (supplierConfirmed, supplierDateApproved) → SUCCESS; high/medium → WARNING;
info → INFO (no popup unless the kind is listed).

## 8. Popup UX
One `NotificationHost` mounted in `Layout` (every page). Top-right on desktop, a compact
full-width banner on phones placed under the top bar (never over the bottom tab bar).
At most 3 visible, the rest queued. SUCCESS ~6 s, WARNING ~9 s, CRITICAL sticky until
View or Dismiss. Actions: primary deep link + secondary (View Supplier / Transfer options).
Icon + word for severity (not colour only). `aria-live="polite"`, critical `assertive`.
Respects `prefers-reduced-motion`. The existing bottom-right action toasts stay for
"saved/failed" feedback — a different job.

## 9. Sound
`NotificationSoundManager` (`src/lib/notificationSound.ts`): Web Audio synthesised tones —
no audio files, nothing for the CSP to admit. success = two soft rising notes (~250 ms),
warning = two level notes (~400 ms), critical = three short pulses (~700 ms). Volume 0–1.
Every call is wrapped: a failure is swallowed and reported as a result, never thrown.

## 10. Autoplay
One AudioContext, created lazily; `resume()` on the first pointerdown/keydown anywhere.
If a sound is due while the context is still suspended, the host shows one small
"เปิดเสียงแจ้งเตือน [เปิดเสียง]" strip, once per device (localStorage); clicking it is the
user gesture that unlocks and plays a test tone.

## 11. Dedup
Popups and sounds key on the notification id (already the dedup key). The first
snapshot after sign-in is the baseline: everything in it is history — listed in the bell,
never popped, never played. After that only ids not seen this session pop, and only if
created in the last 10 minutes (a reconnect that re-delivers old docs pops nothing).
Seen ids reset on sign-out / user change.

## 12. Burst aggregation
New notifications arriving within 1.5 s are batched: 1–2 pop individually; 3+ of the same
category collapse into one popup ("5 รายการใหม่ · สต๊อก" + first three titles + "+2"),
linked to the Notification Center filtered tab. One sound per batch, the most severe.

## 13. Files
N1–N3: `src/lib/notificationPresentation.ts`, `src/lib/notificationSound.ts`,
`src/lib/notificationQueue.ts` (pure dedup/burst/queue), `src/components/notifications/NotificationHost.tsx`,
`src/components/Layout.tsx` (mount), `src/i18n/en.ts`, tests.
N4+: kinds for po_overdue / supplier opened, Orders live-merge of the open PO,
risk kinds (after S3/S4), `NotificationPrefsSection` (sound settings), rules `validPrefs`.

## 14. Migration
None for N1–N3. N6 adds an optional `sound` map to the prefs document (rules: one key).

## 15. Tests
Pure: presentation (severity per kind, actions, popup/sound flags), queue (baseline is
history, reconnect re-delivery, duplicate id, burst ≥3 aggregates, max 3 visible + queue,
critical sticky, dismiss, user switch resets), sound manager (disabled, volume, suspended
context → needs-unlock, play throwing → reported not thrown). Then the UI in the demo at
desktop and phone width.
