# Excel import: product ranking for unmatched rows

Base `af0136b0f6886989bc32d651a384ac05b39cdad6`. Branch `fix/product-match-ranking`.

## Owner report, 15 Oct 2026

Workbook row 36, `RANCH 1 kg.`, showed `ใกล้เคียง: MAYONNAISE 1KG (FB FOOD)` in the import preview. The catalogue item is `RANCH (PICHON)`, SKU `PZS-01-06-001`. Typing `ranch` in the product search found it at once.

## Root cause

`matchProduct()` ranked unmatched rows with `similarity()`, a Sørensen–Dice score over every word of the normalised name. Numbers and unit words counted as much as the product's name. `normaliseName` drops the bracketed supplier, so the catalogue key for `RANCH (PICHON)` is `RANCH`:

| Row `RANCH 1 KG` against | Shared words | Old score |
|---|---|---|
| `MAYONNAISE 1 KG` | `1`, `KG` | 2·2 / (3+3) = 0.67 |
| `RANCH` | `RANCH` | 2·1 / (3+1) = 0.50 |

Mayonnaise won on its pack size. The request form's product picker had the same flaw in its fallback score, and its word-order search counted `ranch` inside `BRANCH`, so typing `RANCH 1 KG` there listed `GAS 48 KG Branch 1` first.

## Change

- `productSimilarity()` in `src/lib/productMatch.ts` scores the name words only. Numbers and pack or unit words (`KG`, `G`, `ML`, `PACK`, `PCS`, `X` and similar) are kept apart as sizes. A candidate needs at least one shared name word, so a shared `1 KG` alone scores 0. A size both names state and agree on adds 0.25. A size both state and disagree on subtracts 0.5 and sets `sizeConflict`, so `PENNE 1KG` is still offered for `PENNE 500G` but marked as a different pack.
- A one-letter typo in a long word still counts as the same word (`MOZARELLA` is `MOZZARELLA`). The first letter must agree, so `BRANCH` is not `RANCH`.
- `safeSuggestion()` picks the preview hint: the best candidate that is in use and has no size conflict. If there is none, no hint is shown.
- The product picker's search moved unchanged into `src/lib/productSearch.ts`, then its fallback was switched to `productSimilarity()`. A word-order match that shares no whole name word now ranks below one that does. The resolve dialog's search uses the same score.

Unchanged: SKU, confirmed aliases, exact names and the unit-word-only (`2.72 kg*8` against `2.72*8`) match still answer before any ranking, and they are the only automatic matches. Every ranked candidate stays a choice for a person. Two products with the same name are still `ambiguous`. Inactive products are offered but never answered. `ตาม` as a quantity stays `qtyUnclear`, and an unknown unit stays `unitMismatch` (existing tests in `tests/purchase-batch.test.ts`). The matcher reads only the catalogue and aliases already loaded for the current brand, so there are no extra Firestore reads and no cross-brand catalogue. Saved batches, row edits and aliases are not rewritten.

## Verification

| Check | Result |
|---|---|
| `tests/product-match-ranking.test.ts` on the original matcher and picker | 10 of 22 failed, each on an Owner case (Mayonnaise first, Gas first, Penne against Mascarpone 500 G, no size flag) |
| Same file with the change | 22/22 passed |
| `npx playwright test -c playwright.match.config.ts` on the original code | 2/2 failed: preview hint `MAYONNAISE 1KG (FB FOOD)`, picker first result `GAS 48 KG Branch 1` |
| Same suite with the change | 2/2 passed, no retries |
| `npm test` | 1348 passed, 110 files |
| Lint, i18n, build | Exit 0. No lint warning in a touched file |
| Main CI bundle budget | Passed: main 2932 KB, initial JS 3447 KB against 3450 KB |

The browser suite runs the real app in demo mode with three synthetic products named as in the Owner's screenshot. It uploads a generated workbook to `/purchase/import` and types into the `/requests/new` picker. It uses no emulator ports and no live data.

## Screenshots

`before-import-hint.png` and `before-picker.png` are the original code on identical data. `after-import-hint.png`, `after-resolve-choices.png` and `after-picker.png` show the change. The row still reads ต้องตรวจ and Save stays disabled until a person picks the product.

## Not covered here

The Owner's full catalogue was not used, and no production data was read. Global search ranking, OCR review and the LINE import's `suggestProducts()` keep their own scorers. `suggestProducts()` already ignores sizes. Aligning them under one engine is the Matching Engine 2.0 work. Independent OpenCode review and Preview QA are pending.

## Skills

Superpowers `systematic-debugging`, `test-driven-development` and `verification-before-completion`, plus `humanizer` for this file, were read in the session that finished this branch. The root cause was confirmed by arithmetic on the old score before any further change. Unit and browser tests were run against the original code and failed for the reported reasons before the change was restored and rerun.
