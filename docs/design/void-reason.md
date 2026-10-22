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
