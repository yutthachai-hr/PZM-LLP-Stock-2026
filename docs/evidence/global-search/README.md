# Global search: historical document lookup

Base `af0136b0f6886989bc32d651a384ac05b39cdad6`. Branch `fix/global-search-documents`.

## Owner report

Typing `INV2026080528` in the top bar answered "ไม่พบในข้อมูลที่โหลดไว้". The bill is from August 2026.

## Root cause

1. `src/lib/globalSearch.ts` matches documents only against `src.movements`, the stock movements held in memory. Since 23 Sep 2026 that window is `RECENT_DAYS = 7`. Nothing older can match, and the bar never asks the database.
2. `/movements?doc=RC-…` filters only the rows already fetched for the page's day window (`Movements.tsx`). An older document rendered an empty list even with a correct URL.
3. `/orders?po=<id>` looks only inside the 30-day order window. An older order was silently ignored and the parameter cleared.

## Where a bill number is stored

| Era | Field | Searchable by equality |
|---|---|---|
| Receipts since 24 Sep 2026 | `stockMovements.invoiceNo` on every receipt line | Yes |
| Orders received before 24 Sep 2026 | `purchaseOrders.invoiceNo` (the latest receipt's bill) | Yes |
| Manual receipts keyed before 24 Sep 2026 | Free text inside `note` | **No.** Firestore cannot query inside text |
| App document numbers | `stockMovements.docNo` (RC, IS, ADJ, CS) and `purchaseOrders.docNo` (PO, numbered per supplier) | Yes |

Partial receipts, which also arrived on 24 Sep 2026, carry `invoiceNo` on each receipt's movements, so a PO's earlier bills are found through the movements.

## Fix

- **Stage 1, unchanged.** Instant local results from loaded data.
- **Stage 2, new: `src/services/documentLookup.ts`.** It is lazy-loaded (a 1,563-byte chunk) and runs only for document-like entries (`src/lib/documentQuery.ts`), 350 ms after typing stops. It makes equality queries only, scoped to the current brand. Stale answers are dropped, results are deduplicated by document, and lookups that found something are cached per brand for the session. A number not found is asked again, because the bill may be received in between.
- **Spellings.** A bill number is tried as typed, in capitals, and without inner spaces. App numbers are normalized the way the app writes them, so `rc 12` becomes `RC-00012`. No other variants are guessed. A bill stored as `INV-2026` is not found by typing `INV2026`, and the footer says the match is exact.
- **Honest outcome.** "Not found" names the sources searched. For bill numbers it also states that bills typed into notes before 24 Sep 2026 are not searchable there yet.
- **Deep links.** `/movements?doc=` reads that one document by equality when it is outside the window. `/orders?po=` reads that one order by id when it is outside the window.

Access is unchanged. Brand-prefixed collections give brand isolation, and Firestore rules (`active()`) already govern who may read movements and orders. No rule, index or schema changed. Firestore's automatic single-field indexes serve these queries; `firestore.indexes.json` has no field overrides, and `receiptDocs.ts` already relies on the same queries in production.

## Read budget

| Action | Before | After |
|---|---|---|
| Ordinary word (`flour`, `ชีส 2 kg`, `MOZZARELLA 2.72`) | 0 reads | 0 reads |
| Bill number, first search | 0 reads, wrong answer | 2 to 6 equality queries (2 collections × at most 3 spellings). Each is billed 1 read when empty, plus 1 read per matching row |
| App document number | 0 reads | 1 equality query, plus the document's rows |
| Same search again in the session | not applicable | 0 reads when it was found (cache). A number not found is queried again |
| Opening an old `?doc=` or `?po=` link | empty page | 1 equality query or 1 document read |

No listener is added and nothing scans the ledger. Unit tests assert the exact queries made: `stockMovements.invoiceNo` and `purchaseOrders.invoiceNo` for `INV2026080528`, and none for words.

## Verification

| Check | Result |
|---|---|
| `tests/document-lookup.test.ts`, first run | Failed: module missing |
| Same file after the fix | 16/16 passed. The 16th was added in review: an empty answer was cached, so a bill received later in the session still read as not found. It failed before the cache kept answers only |
| `npx playwright test -c playwright.search.config.ts` on the original code | 10/10 failed for the reported reasons (no option for the August bill, empty old receipt link, August PO bill not found) |
| Same suite after the fix | 10/10 passed, zero retries |
| `npm test` | 1342 passed, 110 files |
| Build, lint and i18n | Passed; lint 0 errors |
| Main CI bundle budget | Passed. Initial JS is 498 bytes **smaller** than main, because the lookup is lazy-loaded |

The browser suite runs the real app in demo mode with synthetic records. It covers: the Owner's number, an old receipt link on direct reload, an old PO bill, a missing number, deduplication with loaded results, keyboard selection, cross-brand isolation, a lookup in flight when the brand changes, search after changing history dates, and English text. Same-number-from-two-suppliers, PO numbers shared across suppliers, case variants, voided rows and read bounds are covered in unit tests.

One mid-run failure: the fixture bill `INV-RECENT-77` is 82% letters, which the classifier deliberately treats as a word so that product searches cost no reads. The fixture was changed to a realistic number. The classifier was not loosened.

## Not yet verified

- **Whether `INV2026080528` exists in production, and in which field.** No authorized read-only production mechanism was available in this session, so no production data was read and no claim is made either way. After deployment, typing the number performs at most two equality queries and reports the answer. If it was a manual receipt keyed before 24 Sep 2026, the bar will say it is in the unindexed note era.
- **Legacy note-era bills.** A historical, brand-scoped document index needs Owner approval for a new collection, an authorized backup or read-only extraction, and a reconciled dry run. It is not built here and no production data is migrated.
- Independent OpenCode review is BLOCKED by the upstream model-quota cooldown until about 07:28 UTC. Remote Preview QA is pending behind Cloudflare Access.

## Screenshots

`before/inv2026080528-not-found.png` is the original code's answer on identical synthetic data. `after/inv2026080528-found.png` and `after/missing-number.png` show the fix.

## Skills

The Superpowers `systematic-debugging`, `test-driven-development` and `verification-before-completion` SKILL.md files were read in this session. Phase 1 read the code path and confirmed the root cause in source before any change. Unit and browser tests failed first, for the reported reasons, then passed. Gates were rerun with output read before any claim.
