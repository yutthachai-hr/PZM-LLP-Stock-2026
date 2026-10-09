# B2 — Audit log (owner approved 6 Oct 2026): evidence

## What is recorded

Collection `auditLog` (`lelapin__auditLog` for Le Lapin), written by `src/services/auditLog.ts`.

**Fields**

| Field | Content |
|---|---|
| `actorId`, `actorName`, `actorRole` | Who made the change |
| `action` | e.g. `product.update`, `user.role`, `backup.restore` |
| `entityType`, `entityId` | What was changed |
| `before`, `after` | Only the changed fields; large values such as images are summarised |
| `reason` | Optional |
| `operationId` | Shared by every entry one operation writes |
| `createdAt` | When |

**Coverage**

| Area | Actions |
|---|---|
| Products | create · update · activate / deactivate · delete |
| Locations | create · update · activate / deactivate · delete |
| Suppliers | create · update · activate / deactivate · delete |
| Supplier price rows | create · update · delete |
| Unit conversions | set · change unit · migrate · rebase |
| Users | create · update · role · activate / deactivate · delete · restore |
| Settings and thresholds | inventory settings · entry units · company profile · count schedules |
| Thresholds via product edits | product `minStock` and cost changes are recorded through `product.update` |
| Maintenance | recompute balances · rebuild a product's balances |
| Sensitive corrections | edit / void a movement (with its reason) · PO renumbering (from / to) · backup restore (mode and counts) |

## How it is protected

**One transaction for single-document changes.** The change and its entry are written together
(`auditedUpdate`), so neither can exist without the other. Tests:
- "a refused change leaves no entry";
- "a refused entry refuses the change".

**Multi-step operations** (delete, restore, migration) record their entry when they finish:
- If that write fails, the entry waits in a device outbox and is sent on the next write or
  sign-in.
- It never fails or undoes the change.

**Rules** (`tests/audit-log-rules.test.ts`, 4 tests):
- **Create:** any active user, only in their own uid **and** their own role, with a fixed
  shape, a known `entityType`, and an id pattern.
- **Dates:** `createdAt` may not be in the future, nor older than 7 days (the outbox window).
- **No update and no delete for anyone**, admins included.
- **Read:** admins only, and a list query must carry `limit <= 50`. An unbounded read or a
  listener on the whole collection is refused.

**No realtime listener.** Settings → "ประวัติการแก้ไข" (admin only) loads one page of 50 when
opened and another only on "load 50 more". The page is read with `backend.page()`: one
field, descending, limited, so no composite index is needed.

## Tests

| Suite | Tests | What they cover |
|---|---:|---|
| `tests/audit-log.test.ts` | 10 | What each kind of change records; brand separation; summarising large values; transaction atomicity both ways; outbox and resend; no anonymous entries; pagination |
| `tests/audit-log-rules.test.ts` | 4 | Append in your own name; forgery refused; immutable for everyone; admin-only bounded reads |
| `e2e/audit.spec.ts` | 1 | An admin adds a location in the UI. The entry appears in the emulator and in the history screen, and the admin's own token cannot rewrite it (403). |

**Full run after the change:**

| Gate | Result |
|---|---|
| Unit | 1,307 passed |
| Rules | 229 passed |
| e2e | 31 of 31 |
| tsc, oxlint, i18n | clean |

## Limitations

- **Not in the app backup.** The backup reads collections whole, and the rules refuse that for
  the audit log on purpose. For an off-site copy, use a Firestore managed export
  (`gcloud firestore export`) of `auditLog` and `lelapin__auditLog`.
- **User changes are logged in the brand the admin is working in.** The roster itself is
  shared by both brands.
- **Console edits are not recorded.** A change made directly in the Firebase console bypasses
  the app. This is expected for an app-level log; such edits appear in Cloud Audit Logs.
- **Stock movements are not duplicated here.** Receipts, issues, counts and transfers are
  already their own append-only ledger with the actor on every row. Only edits and voids of
  that ledger are logged.
- **Read cost:** about one read per audited single-document edit (the transaction reads the
  document before changing it), plus 50 per page viewed.
