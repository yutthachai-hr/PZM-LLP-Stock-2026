# Stock buckets (owner decision, 22 Oct 2026)

| Bucket | Definition | Where |
|---|---|---|
| Branch (available) | `qtyAt(site, product)`; never includes transit | branch views, low stock, issue/transfer availability (unchanged) |
| In transit | `transitQty(product)` = balance at `locations/transit` | shown on its own line wherever a company figure is shown |
| Reserved | not applicable: the app has no reservation concept | — |
| Company total | `companyQty(product)` = every site (including inactive sites) + in transit, counted once | Stock Card (headline/value/trend), Products value tile (all sites), Cost Report, Reports Overview, Dashboard value, PhoneHome category value, TopBar search, Reports snapshot |

Stock Card's low/out badge uses available site stock, not the transit-inclusive headline.
Negative transit is an integrity anomaly, not inventory disposal: retain it in accounting and show
its line (not only positive transit), rather than silently clamping one screen but not another.
`transit` is the canonical id created by `ensureTransitLocation`; other ids with type transit
remain unsupported and must be investigated, not silently used for branch availability.

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

No data, schema, Rules or Worker change; no backfill. Products list rows/status and purchase
request snapshots remain per-site availability (operational "where is it"), not company ownership.
The Worker currently passes unfiltered locations into inventoryInsights: transit reorder advice
is a pre-existing audit finding, not fixed or claimed safe by this UI PR. Track it separately.
An over-receipt from an under-recorded dispatch belongs to DISPATCH_WRONG (source -> destination,
company unchanged); APPROVED_ADJUSTMENT is for genuinely found stock and increases company stock.
