# Voiding a stock movement requires a reason (owner P0, 22 Oct 2026)

## Behaviour
- Admins void through `ReasonModal` (shared with purchase requests): required, trimmed, 1–500
  characters with a counter. The text survives a failed save; a second tap while saving is ignored.
- `voidMovement(id, actor, reason)` validates with `normaliseVoidReason` and writes `voidReason`,
  `voidedAt`, `voidedBy`, `voidedByName` with `voided` in the same transaction as the balance
  reversal. Voiding an already-voided row is a no-op: no second reversal, the first reason stays.
- Movements, Stock Card (voided rows are now listed, with no quantities or balance), Stock Card
  Excel/PDF and the Activity Log (screen + Excel) show reason, person and time via `voidSummary`.
- Rows voided before this change show "Legacy record: no void reason" with their last-updated
  person/time. No reason is ever back-filled.

## Rules (`voidedHonestly` in firestore.rules)
Only an admin, only false→true, all four fields written together, reason non-blank after trim and
≤500, `voidedBy` = caller. No un-voiding, no rewriting the reason, no inventing one for legacy rows,
no cancellation fields on create or on an ordinary edit. The balance reversal itself remains a
client transaction; proving it server-side is the trusted stock-command work (r33 prototype).

## Rollout (Rules need separate Owner approval — CI does not deploy them)
- **Coupled release.** Production `movementCore` whitelists movement keys, so a new client's void
  (with the four new fields) is refused until the new Rules are live. Order: deploy the reviewed
  Rules, then the app — in one Owner-approved window. Not eligible for the code-only auto-merge.
- Once the new Rules are live, an old cached client's reason-less void is refused ("permission
  denied") until it reloads. Intended: every new void carries a reason.
- Rollback: revert the app merge and redeploy the previous Rules together. Rows voided with the new
  fields stay readable under old Rules (reads are not shape-checked); they can no longer be edited,
  which voided rows never could be anyway. No data migration either way.

Tests: `tests/void-reason.test.ts`, `tests/void-reason-rules.test.ts`, `e2e/void-reason.demo.ts`.

## R57 security review (DeepSeek v4.1 flash, independent) — changes and accepted risk
- `voidedAt` must be within 10 minutes of the server's `request.time`: a cancellation cannot be
  backdated. A phone clock more than 10 minutes off gets "permission denied" and must fix its clock.
- `voidedByName` must equal the caller's profile `name` at that moment (the app's `actor.name` is
  that profile, subscribed live), max 200 characters. This stops a client typing any name; it does
  not stop someone who first renames their own profile. `voidedBy` (the uid) is the identity that counts.
- The balance key trims the unit exactly like `levelId()`; a movement stored with `'KG '` was
  unvoidable before (fail closed) and now cancels against its real row.
- Tests: `tests/void-atomic.emulator.test.ts` checks each of blank reason, another admin's uid,
  backdated time, forged name and manager role **with the exact reversal present**, so each denial
  has one cause. RED on the pre-R57 Rules (backdate, name, spaced unit), GREEN after; Rules suite 291/291.
- **Accepted risk (needs the trusted server, r33):** the reversal check proves the end state of the
  commit, not that this commit made the change — an admin who first moves the balance in a separate
  write can then cancel bare. The same batch may also carry unrelated balance writes. Rules cannot
  prove the balance was right to begin with.
- Deploy order unchanged: both mismatched states fail closed (void refused, nothing written), so the
  only cost of the window is that voiding is briefly unavailable. Rules first, then the app, together.
