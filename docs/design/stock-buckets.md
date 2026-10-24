# Stock buckets (owner decision, 22 Oct 2026)

| Bucket | Definition | Where |
|---|---|---|
| Branch (available) | `qtyAt(site, product)`; never includes transit | branch views, low stock, issue/transfer availability (unchanged) |
| In transit | `transitQty(product)` = canonical `transit` + other locations marked `type: transit`, each once | shown on its own line wherever a company figure is shown |
| Reserved | not applicable: the app has no reservation concept | — |
| Company total | `companyQty(product)` = every site (including inactive sites) + in transit, counted once | Stock Card (headline/value/trend), Products value tile (all sites), Cost Report, Reports Overview, Dashboard value, PhoneHome category value, TopBar search, Reports snapshot |

Stock Card's low/out badge uses available site stock, not the transit-inclusive headline.
Negative transit is an integrity anomaly, not inventory disposal: retain it in accounting and show
its line (not only positive transit), rather than silently clamping one screen but not another.
`transit` is the canonical id created by `ensureTransitLocation`; a location of type transit under
any other id is counted once in the in-transit line and the company total, and is never offered as
branch availability. Company valuation never filters out inactive products:
hiding a product or closing a site does not dispose of its stock.

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

No data, schema, Rules or Worker deployment; no backfill. The shared `stockView` now keeps
transit out of its unstocked-product home-site choice; Worker reorder logic is not changed. Products list rows/status and purchase
request snapshots remain per-site availability (operational "where is it"), not company ownership.
The Worker currently passes unfiltered locations into inventoryInsights: transit reorder advice
is a pre-existing audit finding, not fixed or claimed safe by this UI PR. Track it separately.
An over-receipt from an under-recorded dispatch belongs to DISPATCH_WRONG (source -> destination,
company unchanged); APPROVED_ADJUSTMENT is for genuinely found stock and increases company stock.

## R35 reader integration and regression coverage

`DataContext` supplies raw locations to the bucket builder, not the transit-filtered picker list.
`transitLocationIds` is shared with Reports: as-of snapshots rewind each transit location's own
movement delta before aggregating. Rewinding only the canonical id is wrong for imported transit
locations. Unknown legacy entry-unit balances remain separate; no conversion/backfill is guessed.

Phone category values retain negative quantities and cents; a negative category has no positive
bar. Cost reports retain inactive products that still have base-unit stock, and no-history Excel
rows carry the same company/transit quantities as historical rows. Snapshot Excel preserves the
numeric monetary value instead of rounding every row to whole baht.

`playwright.transit.config.ts` runs synthetic browser storage on exclusive port5201 (also CI).
It covers Dashboard, Products, Stock Card (including empty-site/positive-transit and signed
negative transit), PhoneHome, TopBar, Reports Overview, CostReport/Excel and backdated snapshot/
Excel. The unit suite covers partial/full receipt, cancellation/return/loss, inactive sites,
secondary transit locations, zero/negative balances, company value and site-only home selection.
No browser test authorizes or mutates live stock, and no prototype lifecycle claim is implied.

R35 release remains HOLD until fresh exact-head independent review and CI. Full lifecycle
command/E2E coverage, Worker reorder advice and real authenticated hosted QA remain separate gates.
