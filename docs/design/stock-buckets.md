# Stock buckets (owner decision, 22 Oct 2026)

| Bucket | Definition | Where |
|---|---|---|
| Branch (available) | `qtyAt(site, product)`; never includes transit | branch views, low stock, issue/transfer availability (unchanged) |
| In transit | `transitQty(product)` = balance at `locations/transit` | shown on its own line wherever a company figure is shown |
| Reserved | not applicable: the app has no reservation concept | — |
| Company total | `companyQty(product)` = every site + in transit, transit counted once even if the caller's location list includes it | Stock Card (all sites), Cost Report valuation, Dashboard value, PhoneHome category value, TopBar search, Reports snapshot (all locations) |

One definition: `stockView` in `src/lib/inventoryRules/stockView.ts`, exposed by `DataContext`.

## Why it reconciles

The all-sites ledger (`effectOverall`) and the dashboard's seven-day comparison (`valueAsOf`)
already treat a movement between two of our own locations as zero. Transit is one of our
locations, so dispatch (site → transit), receipt (transit → site), return/cancellation
(transit → source) never change the company total; only a movement with one side outside the
company (receipt from a supplier, use, loss, an adjustment) does. Before this change the
headline figures summed sites only, so they dropped while goods were on the road and disagreed
with the ledger beneath them by exactly the quantity in transit.

`tests/stock-buckets.test.ts` walks synthetic transfers (dispatch, partial receipt, return, loss
in transit) through the real ledger and balance functions and checks every bucket, the ledger's
own total, the trend series and the valuation comparison.

## Not changed

No data, schema, Rules or Worker change; no backfill. The cron Worker's low-stock rule still
reads per-site balances. Products list totals remain per-site (operational "where is it").
