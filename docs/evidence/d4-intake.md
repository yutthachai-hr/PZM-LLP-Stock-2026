# D4′ — Batch Excel purchasing merged into the purchase-request workflow (owner approved 6 Oct 2026)

## One workflow, several intakes

Every purchase now goes **intake → purchase request → manager approval → purchase orders by
supplier**. There is no longer a parallel Excel-batch route that skips the request.

| Intake | Where | Recorded as |
|---|---|---|
| Typed / picked by hand | Request editor | `manual` |
| The company order workbook (Excel) | Request editor → "นำเข้าจากใบสั่งของ (Excel)", or the file import with a spreadsheet | `excel` |
| Photo or PDF read by AI | Request editor → "นำเข้าจากไฟล์ (Excel / รูป / PDF)" with a picture or PDF | `ocr` |
| Daily system suggestions | Dashboard → draft request | `suggestion` |
| Future system suggestion | Same field, same path | `suggestion` |

**How the channel is recorded**
- `PurchaseRequest.intake` lists the channels a request's lines came through, once each, in
  first-use order.
- Older requests have no field and read as manual.
- The request screen shows "ที่มา: …". Each file import also writes its file name and order
  round into the request history, as it did before.

**Suggestions stay suggestions.** A suggestion only ever creates a **draft** request. A person
sends it and a manager approves it, the same as any other request. Nothing is ordered
automatically. Test: "a system suggestion is a channel, not an approval".

## What changed for staff

| Entry point | Before | Now |
|---|---|---|
| Dashboard tile "สร้างใบสั่งซื้อจาก Excel" | Batch import | "ขอสั่งซื้อจาก Excel" → a new request with the Excel import open |
| Orders page "นำเข้า Excel (ทางเลือก)" | Batch list | "ขอสั่งซื้อจาก Excel" → same as above |
| `/purchase/import` (old links and bookmarks) | Batch import | Redirects to `/requests/new?import=1` |
| `/purchase` and `/purchase/:id` | Batch list and review | **Kept**, so historical batches stay viewable and an open batch can still be finished. The page now says new Excel lists go through a request, and its button opens the request import. |

**Code:** the new-batch screen (`PurchaseImport.tsx`) is removed. `services/purchaseBatch.ts`
and the batch review page remain, so every existing batch, and the orders it created, work
exactly as before. **No data is migrated or rewritten.**

## Rules

`purchaseRequests` (both brands) accepts an optional `intake`: a list of at most 4 values,
each one of `manual`, `excel`, `ocr`, `suggestion`. It is editable like the lines.

Tests (`tests/firestore-rules-budget.test.ts`):
- a channel is accepted, and so is all four;
- an unknown channel, a non-list, or a fifth entry is refused;
- the widest request (200 lines, 499 history entries, all optional fields **plus** a full
  `intake`) still fits the 1,000-expression budget for approval.

## Tests

| Suite | Result |
|---|---|
| `tests/purchase-requests.test.ts` | +3 tests (41 in all): channel order and dedupe, suggestion stays a draft, Excel request goes through the same submit → approve (staff refused) path |
| Unit | 1,337 passed |
| Rules | 230 passed |
| e2e | 31 / 31 |
| tsc, oxlint, i18n, bundle | clean |

## Note on the rules test time limit

The budget tests write 500-entry documents through the emulator and take a steady
4.4–5.0 s, measured three times. One run failed at 5.09 s against vitest's 5 s default.

`vitest.rules.config.ts` now sets an explicit 30 s time limit, with that measurement in a
comment. This is not a retry: a real failure or hang still fails.
